const config = require('../config');
const request = require('request-promise-native');
const registrationUtils = require('@medic/registration-utils');
const tombstoneUtils = require('@medic/tombstone-utils');
const serverSidePurgeUtils = require('@medic/purging-utils');
const logger = require('./logger');
const { performance } = require('perf_hooks');
const db = require('../db');
const moment = require('moment');

const TASK_EXPIRATION_PERIOD = 60; // days
const TARGET_EXPIRATION_PERIOD = 6; // months

let contactsBatchSize = 1000;
const MAX_REPORTS_BATCH = 10000;
const MAX_REPORTS_REACHED = 'max_size_reached';

const purgeDbs = {};
let currentlyPurging = false;
const getPurgeDb = (hash, refresh) => {
  if (!purgeDbs[hash] || refresh) {
    purgeDbs[hash] = db.get(serverSidePurgeUtils.getPurgeDbName(db.medicDbName, hash));
  }
  return purgeDbs[hash];
};

const initPurgeDbs = (roles) => {
  const initDb = (hash) => {
    const purgeDb = getPurgeDb(hash, true);
    return purgeDb
      .put({ _id: '_local/info', roles: roles[hash] })
      .catch(err => {
        // we don't care about conflicts
        if (err.status !== 409) {
          throw err;
        }
      });
  };

  return Promise.all(Object.keys(roles).map(hash => initDb(hash)));
};

const closePurgeDbs = () => {
  Object.keys(purgeDbs).forEach(hash => {
    db.close(purgeDbs[hash]);
    delete purgeDbs[hash];
  });
};

const getRoles = () => {
  const roles = {};

  return db.users
    .allDocs({ include_docs: true })
    .then(result => {
      result.rows.forEach(row => {
        if (!row.doc || !row.doc.roles || !Array.isArray(row.doc.roles) || !row.doc.roles.length) {
          return;
        }

        if (!serverSidePurgeUtils.isOffline(config.get('roles'), row.doc.roles)) {
          return;
        }

        const hash = serverSidePurgeUtils.getRoleHash(row.doc.roles);
        roles[hash] = serverSidePurgeUtils.sortedUniqueRoles(row.doc.roles);
      });

      return roles;
    });
};

// provided a list of roles hashes and doc ids, will return the list of existent purged docs per role hash:
// {
//   hash1: {
//     id1: rev_of_id_1,
//     id2: rev_of_id_2,
//     id3: rev_of_id_3,
//   },
//   hash2: {
//     id3: rev_of_id_3,
//     id5: rev_of_id_5,
//     id6: rev_of_id_6,
//   }
// }

const getAlreadyPurgedDocs = (roleHashes, docIds) => {
  const purgedDocs = Object.fromEntries(roleHashes.map(hash => [hash, {}]));

  if (!docIds || !docIds.length) {
    return Promise.resolve(purgedDocs);
  }

  const purgeIds = docIds.map(id => serverSidePurgeUtils.getPurgedId(id));
  const changesOpts = {
    doc_ids: purgeIds,
    batch_size: purgeIds.length + 1,
    seq_interval: purgeIds.length
  };

  return Promise
    .all(roleHashes.map(hash => getAlreadyPurgedDocsForRoles(hash, changesOpts)))
    .then(results => {
      results.forEach((result, idx) => purgedDocs[roleHashes[idx]] = result);
      return purgedDocs;
    });
};

const getAlreadyPurgedDocsForRoles = (hash, requestOptions) => {
  // requesting _changes instead of _all_docs because it's roughly twice faster
  return getPurgeDb(hash)
    .changes(requestOptions)
    .then(result => {
      const purged = {};

      result.results.forEach(change => {
        if (!change.deleted) {
          const docId = serverSidePurgeUtils.extractId(change.id);
          purged[docId] = change.changes[0].rev;
        }
      });

      return purged;
    });
};

const getPurgeFn = () => {
  const purgeConfig = config.get('purge');
  if (!purgeConfig || !purgeConfig.fn) {
    return;
  }

  let purgeFn;
  try {
    purgeFn = eval(`(${purgeConfig.fn})`);
  } catch (err) {
    logger.error('Failed to parse purge function: %o', err);
    return;
  }

  if (typeof purgeFn !== 'function') {
    logger.error('Configured purge function is not a function');
    return;
  }

  return purgeFn;
};

const updatePurgedDocs = (rolesHashes, docIds, alreadyPurged, toPurge) => {
  const updatePromises = rolesHashes.map(hash => {
    const docs = [];
    docIds.forEach(id => {
      const isPurged = alreadyPurged[hash][id];
      const shouldPurge = toPurge[hash][id];

      // do nothing if purge state is unchanged
      if (!!isPurged === !!shouldPurge) {
        return;
      }

      if (isPurged) {
        docs.push({ _id: serverSidePurgeUtils.getPurgedId(id), _rev: isPurged, _deleted: true });
      } else {
        docs.push({ _id: serverSidePurgeUtils.getPurgedId(id) });
      }
    });

    if (!docs.length) {
      return Promise.resolve([]);
    }

    return getPurgeDb(hash).bulkDocs({ docs });
  });

  return Promise.all(updatePromises);
};

const validPurgeResults = (result) => result && Array.isArray(result);

const addContactToContext = ({ id: docId, doc: contact }, purgeContext) => {
  const contactContext = {
    contact: {},
    reports: [],
    messages: [],
    docIds: [],
  };

  if (tombstoneUtils.isTombstoneId(docId)) {
    // we keep tombstones here just as a means to group reports and messages from deleted contacts, but
    // finally not provide the actual contact in the purge function. we will also not "purge" tombstones.
    docId = tombstoneUtils.extractStub(docId).id;
    contactContext.contact = { _deleted: true };
    contactContext.subjectIds = registrationUtils.getSubjectIds(contact.tombstone);
  } else {
    contactContext.contact = contact;
    contactContext.subjectIds = registrationUtils.getSubjectIds(contact);
    contactContext.docIds.push(docId);
  }

  purgeContext.groups[docId] = contactContext;
  purgeContext.subjectIds.push(...contactContext.subjectIds);
};

const getRecordContextInfo = (row, purgeContext) => {
  const { doc, id: docId, key } = row;

  if (purgeContext.groups[docId]) { // context already exists
    return;
  }

  if (tombstoneUtils.isTombstoneId(docId)) { // we don't purge tombstones
    return;
  }

  if (doc.type !== 'data_record') {
    return;
  }

  if (!doc.form) {
    // messages only emit once, either their sender or receiver
    return { subject: key, message: doc };
  }

  const subjectId = registrationUtils.getSubjectId(doc);
  if (doc.needs_signoff) {
    // reports with needs_signoff will emit for every contact from their submitter lineage,
    // but we only want to process them once, either associated to their patient or alone, if no patient_id
    if (subjectId && !purgeContext.subjectIds.includes(subjectId)) {
      // if the report has a subject, but it is not amongst the list of keys we requested, we hit the emit
      // for the contact or it's lineage via the `needs_signoff` path. Skip.
      return;
    }
    const submitter = doc.contact && doc.contact._id;
    if (!subjectId && !purgeContext.subjectIds.includes(submitter)) {
      // if the report doesn't have a subject, we want to process it when we hit the emit for the submitter.
      // if the report submitter is not amongst our request keys, we hit an emit for the submitter's lineage. Skip.
      return;
    }
  }

  // use patient_id as a key, to keep subject to report associations correct
  // reports without a subject are processed individually, so use their uuid as key
  return { subject: subjectId === key ? subjectId : docId, report: doc };

};

const groupReportsBySubject = (recordRows, purgeContext) => {
  const recordsBySubject = {};
  recordRows.forEach(row => {
    const recordInfo = getRecordContextInfo(row, purgeContext);
    if (!recordInfo) {
      return;
    }
    const { subject, report, message } = recordInfo;
    recordsBySubject[subject] = recordsBySubject[subject] || { reports: [], messages: [] };

    return report ?
      recordsBySubject[subject].reports.push(report) :
      recordsBySubject[subject].messages.push(message);
  });
  return recordsBySubject;
};

const addRecordsToContext = (rows, purgeContext) => {
  const recordsBySubject = groupReportsBySubject(rows, purgeContext);

  Object.keys(recordsBySubject).forEach(subject => {
    const records = recordsBySubject[subject];
    const contactContext = Object
      .values(purgeContext.groups)
      .find(contactContext => contactContext.subjectIds.includes(subject));

    if (!contactContext) {
      // reports that have no subject are processed individually
      records.reports.forEach(report => {
        purgeContext.groups[report._id] = {
          contact: {},
          reports: [report],
          messages: [],
          docIds: [],
          subjectIds: []
        };
      });
      return;
    }

    contactContext.reports.push(...records.reports);
    contactContext.messages.push(...records.messages);
  });
};

const assignAllDocsIds = (purgeContext) => {
  Object.values(purgeContext.groups).forEach(contactContext => {
    contactContext.docIds.push(...contactContext.messages.map(message => message._id));
    contactContext.docIds.push(...contactContext.reports.map(message => message._id));
    purgeContext.docIds.push(...contactContext.docIds);
  });
};

const getDocsToPurge = (purgeFn, purgeContext) => {
  const rolesHashes = Object.keys(purgeContext.roles);
  const toPurge = {};

  Object.values(purgeContext.groups).forEach(contactContext => {
    const { docIds, contact, reports, messages } = contactContext;

    rolesHashes.forEach(hash => {
      toPurge[hash] = toPurge[hash] || {};
      if (!docIds.length) {
        return;
      }

      const idsToPurge = purgeFn({ roles: purgeContext.roles[hash] }, contact, reports, messages);
      if (!validPurgeResults(idsToPurge)) {
        return;
      }

      idsToPurge.forEach(id => {
        toPurge[hash][id] = docIds.includes(id);
      });
    });
  });

  return toPurge;
};

const batchedContactsPurge = (roles, purgeFn, startKey = '', startKeyDocId = '') => {
  let nextKeyDocId;
  let nextKey;
  const purgeContext = {
    groups: { },
    subjectIds: [],
    docIds: [],
    roles,
    roleHashes: Object.keys(roles),
  };

  logger.info(
    `Starting contacts purge batch: key "${startKey}", doc id "${startKeyDocId}", batch size ${contactsBatchSize}`
  );

  const queryString = {
    limit: contactsBatchSize,
    start_key: JSON.stringify(startKey),
    startkey_docid: startKeyDocId,
    include_docs: true,
  };

  // using `request` library because PouchDB doesn't support `startkey_docid` in view queries
  // using `startkey_docid` because using `skip` is *very* slow
  return request
    .get(`${db.couchUrl}/_design/medic-client/_view/contacts_by_type`, { qs: queryString, json: true })
    .then(result => {
      result.rows.forEach(row => {
        if (row.id === startKeyDocId) {
          return;
        }

        ({ id: nextKeyDocId, key: nextKey } = row);
        addContactToContext(row, purgeContext);
      });

      const queryOptions = { keys: purgeContext.subjectIds, include_docs: true, limit: MAX_REPORTS_BATCH };
      return db.medic.query('medic/docs_by_replication_key', queryOptions);
    })
    .then(result => {
      if (result.rows.length >= MAX_REPORTS_BATCH) {
        return Promise.reject({
          code: MAX_REPORTS_REACHED,
          message: `Purging aborted. Too many reports for contact "${nextKeyDocId}"`,
        });
      }

      addRecordsToContext(result.rows, purgeContext);
      assignAllDocsIds(purgeContext);

      return getAlreadyPurgedDocs(purgeContext.roleHashes, purgeContext.docIds);
    })
    .then(alreadyPurged => {
      const toPurge = getDocsToPurge(purgeFn, purgeContext);
      return updatePurgedDocs(purgeContext.roleHashes, purgeContext.docIds, alreadyPurged, toPurge);
    })
    .then(() => nextKey && batchedContactsPurge(roles, purgeFn, nextKey, nextKeyDocId))
    .catch(err => {
      if (err && err.code === MAX_REPORTS_REACHED && contactsBatchSize > 1) {
        contactsBatchSize = Math.floor(contactsBatchSize / 2);
        logger.warn(`Too many reports to process. Decreasing batch size to ${contactsBatchSize}`);
        return batchedContactsPurge(roles, purgeFn, startKey, startKeyDocId);
      }

      throw err;
    });
};

const batchedUnallocatedPurge = (roles, purgeFn) => {
  const type = 'unallocated';
  const url = `${db.couchUrl}/_design/medic/_view/docs_by_replication_key`;
  const getQueryParams = (startKeyDocId) => ({
    limit: MAX_REPORTS_BATCH,
    key: JSON.stringify('_unassigned'),
    startkey_docid: startKeyDocId,
    include_docs: true
  });

  const getPurgedDocs = (rolesHashes, rows) => {
    const docsToPurge = {};
    rolesHashes.forEach(hash => {
      docsToPurge[hash] = docsToPurge[hash] || {};
      rows.forEach(({ doc }) => {
        const purgeResult = doc.form ?
          purgeFn({ roles: roles[hash] }, {}, [doc], []) :
          purgeFn({ roles: roles[hash] }, {}, [], [doc]);

        if (!validPurgeResults(purgeResult)) {
          return;
        }
        docsToPurge[hash][doc._id] = purgeResult.includes(doc._id);
      });
    });

    return docsToPurge;
  };

  return batchedPurge(type, url, getQueryParams, getPurgedDocs, roles, '');
};

const batchedTasksPurge = (roles) => {
  const type = 'tasks';
  const url = `${db.couchUrl}/_design/medic/_view/tasks_in_terminal_state`;
  const maximumEmissionEndDate = moment().subtract(TASK_EXPIRATION_PERIOD, 'days').format('YYYY-MM-DD');

  const getQueryParams = (startKeyDocId, startKey) => ({
    limit: MAX_REPORTS_BATCH,
    end_key: JSON.stringify(maximumEmissionEndDate),
    start_key: JSON.stringify(startKey),
    startkey_docid: startKeyDocId,
  });

  const purgeCallback = (rolesHashes, rows) => {
    const toPurge = {};
    rows.forEach(row => {
      rolesHashes.forEach(hash => {
        toPurge[hash] = toPurge[hash] || {};
        toPurge[hash][row.id] = row.id;
      });
    });
    return toPurge;
  };

  return batchedPurge(type, url, getQueryParams, purgeCallback, roles, '', '');
};

const batchedTargetsPurge = (roles) => {
  const type = 'targets';
  const url = `${db.couchUrl}/_all_docs`;

  const lastAllowedReportingIntervalTag = moment().subtract(TARGET_EXPIRATION_PERIOD, 'months').format('YYYY-MM');
  const getQueryParams = (startKeyDocId) => ({
    limit: MAX_REPORTS_BATCH,
    start_key: JSON.stringify(startKeyDocId),
    end_key: JSON.stringify(`target~${lastAllowedReportingIntervalTag}~`),
  });

  const purgeCallback = (rolesHashes, rows) => {
    const toPurge = {};
    rows.forEach(row => {
      rolesHashes.forEach(hash => {
        toPurge[hash] = toPurge[hash] || {};
        toPurge[hash][row.id] = row.id;
      });
    });
    return toPurge;
  };

  return batchedPurge(type, url, getQueryParams, purgeCallback, roles, 'target~');
};

const batchedPurge = (type, uri, getQueryParams, getDocsToPurge, roles, startKeyDocId, startKey) => {
  let nextKey;
  let nextKeyDocId;
  const rows = [];
  const docIds = [];
  const rolesHashes = Object.keys(roles);

  logger.info(`Starting ${type} purge batch with id ${startKeyDocId}`);
  // using `request-promise-native` because PouchDB doesn't support `start_key_doc_id`
  return request
    .get(uri, { qs: getQueryParams(startKeyDocId, startKey), json: true })
    .then(result => {
      result.rows.forEach(row => {
        if (row.id === startKeyDocId) {
          return;
        }

        ({ id: nextKeyDocId, key: nextKey } = row);
        docIds.push(row.id);
        rows.push(row);
      });

      return getAlreadyPurgedDocs(rolesHashes, docIds);
    })
    .then(alreadyPurged => {
      const toPurge = getDocsToPurge(rolesHashes, rows);
      return updatePurgedDocs(rolesHashes, docIds, alreadyPurged, toPurge);
    })
    .then(() => nextKeyDocId && batchedPurge(type, uri, getQueryParams, getDocsToPurge, roles, nextKeyDocId, nextKey));
};

const writePurgeLog = (roles, duration) => {
  const date = new Date();
  return db.sentinel.put({
    _id: `purgelog:${date.valueOf()}`,
    date: date.toISOString(),
    roles: roles,
    duration: duration
  });
};

// purges documents that would be replicated by offline users
// - reads all user documents from the `_users` database to comprise a list of unique sets of roles
// - creates a database for each role set with the name `<main db name>-purged-role-<hash>` where `hash` is an md5 of
// the JSON.Stringify-ed list of roles
// - iterates over all contacts by querying `medic-client/contacts_by_type` in batches
// - for every batch of contacts, queries `docs_by_replication_key` with the resulting `subject_ids`
// - groups results by contact to generate a list of pairs containing :
//    a) a contact document
//    b) a list of reports which are about the contact (*not submitted by the contact*)
//    c) a list of free form sms messages that the contact has sent or received
// - every group is passed to the purge function for every unique role set
// - the purge function returns a list of docs ids that should be purged
// - for every group, we check which of the documents are currently purged
// (by requesting _changes from the target purge database, using the list of corresponding ids)
// - queries `docs_by_replication_key` with `_unassigned` key and runs purge over every unallocated doc, individually
// - after running purge in every case, we compare the list of ids_to_purge with the ids_already_purged and:
//     a) docs that are already purged and should stay purged, we do nothing
//     b) docs that are already purged and should not be purged, we remove from purged db
//     c) docs that are not purged and should be purged, we add to the purged db
// - we intentionally skip purging "orphaned" docs (docs that emit in `docs_by_replication_key` but that are not
// retrieved when systematically querying the view with all existent subjects), as these docs would not end up being
// replicated
// - we intentionally skip reports that `needs_signoff` when they are retrieved because of the `needs_signoff`
// submitter lineage emit. As a consequence, orphaned reports with `needs_signoff` will not be purged

const purge = () => {
  if (currentlyPurging) {
    return;
  }
  logger.info('Running server side purge');
  const purgeFn = getPurgeFn();
  if (!purgeFn) {
    logger.info('No purge function configured.');
    return Promise.resolve();
  }

  currentlyPurging = true;
  const start = performance.now();
  return getRoles()
    .then(roles => {
      if (!roles || !Object.keys(roles).length) {
        logger.info(`No offline users found. Not purging.`);
        return;
      }
      return initPurgeDbs(roles)
        .then(() => batchedContactsPurge(roles, purgeFn))
        .then(() => batchedUnallocatedPurge(roles, purgeFn))
        .then(() => batchedTasksPurge(roles))
        .then(() => batchedTargetsPurge(roles))
        .then(() => {
          const duration = (performance.now() - start);
          logger.info(`Server Side Purge completed successfully in ${duration / 1000 / 60} minutes`);
          return writePurgeLog(roles, duration);
        });
    })
    .catch(err => {
      logger.error('Error while running Server Side Purge: %o', err);
    })
    .then(() => {
      currentlyPurging = false;
      closePurgeDbs();
    });
};

module.exports = {
  purge,
};
