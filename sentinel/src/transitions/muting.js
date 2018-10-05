const _ = require('underscore'),
      config = require('../config'),
      transitionUtils = require('./utils'),
      db = require('../db-pouch'),
      dbNano = require('../db-nano'),
      utils = require('../lib/utils'),
      messages = require('../lib/messages'),
      mutingUtils = require('@shared-libs/muting-utils');

const TRANSITION_NAME = 'muting',
      CONFIG_NAME = 'muting',
      MUTE_PROPERTY = 'mute_forms',
      UNMUTE_PROPERTY = 'unmute_forms';

const getConfig = () => {
  return config.get(CONFIG_NAME) || {};
};

const isMuteForm = form => {
  return getConfig()[MUTE_PROPERTY].includes(form);
};

const isUnmuteForm = form => {
  const unmuteForms = getConfig()[UNMUTE_PROPERTY];
  return unmuteForms && unmuteForms.includes(form);
};

const getContact = doc => {
  const contactId = doc.fields.patient_id || doc.fields.place_id;

  return db.medic
    .get(contactId)
    .catch(err => {
      if (err && err.status !== 404) {
        throw err;
      }

      return db.medic
        .query('medic-client/contacts_by_reference', { key: ['shortcode', contactId], include_docs: true })
        .then(result => result.rows.length && result.rows[0].doc);
    })
    .then(contact => {
      if (!contact) {
        module.exports._addErr('contact_not_found', getConfig(), doc);
        throw(new Error('Contact not found'));
      }

      return contact;
    });
};

const getDescendants = (contactIds = []) => {
  return db.medic
    .query('medic/contacts_by_depth', { keys: contactIds.map(contactId => ([contactId])) })
    .then(result => result.rows.map(row => ({ _id: row.id, patient_id: row.value })));
};

const updateRegistration = (registration, muted) => {
  let registrationChanged;
  if (muted) {
    registrationChanged = utils.muteScheduledMessages(registration);
  } else {
    registrationChanged = utils.unmuteScheduledMessages(registration);
  }

  if (!registrationChanged) {
    return;
  }

  return db.medic.put(registration).then(() => registration);
};

const updateContacts = (contacts, muted) => {
  contacts.forEach(contact => contact.muted = muted);
  return db.medic.bulkDocs(contacts);
};

const updateRegistrations = (patientIds, muted) => {
  if (!patientIds || !patientIds.length) {
    return [];
  }

  return new Promise((resolve, reject) => {
    utils.getRegistrations({ ids: patientIds, db: dbNano }, (err, registrations) => {
      if (err) {
        return reject(err);
      }

      resolve(registrations);
    });
  }).then(registrations => Promise.all(registrations.map(registration => updateRegistration(registration, muted))));
};

const getEventType = muted => muted ? 'mute' : 'unmute';

const muteAction = (doc, contact) => {
  const currentlyMuted = mutingUtils.isMuted(contact);

  if (currentlyMuted) {
    // don't update registrations if contact is already muted
    module.exports._addErr(contact.muted ? 'already_muted' : 'already_muted_in_lineage', doc);
    return;
  }

  return getDescendants([contact._id]).then(descendants => ({
    contacts: [contact],
    patientIds: descendants.map(descendant => descendant.value).filter(patientId => patientId)
  }));
};

const unmuteAction = (doc, contact) => {
  const currentlyMuted = mutingUtils.isMuted(contact);

  if (!currentlyMuted) {
    // don't update registrations if contact is already unmuted
    module.exports._addErr('already_unmuted', doc);
    return;
  }

  // cascade the unmuting to the whole hierarchy
  let rootContactId = contact._id,
      parent = contact.parent;
  while (parent && mutingUtils.isMuted(parent)) {
    rootContactId = parent._id;
    parent = parent.parent;
  }

  const mutedDescendantIds = [],
        patientIds = [];

  return getDescendants([rootContactId])
    .then(descendants => {
      descendants.forEach(descendant => {
        if (mutingUtils.isMuted(descendant)) {
          mutedDescendantIds.push(descendant._id);
        }
        if (descendant.patient_id) {
          patientIds.push(descendant.patient_id);
        }
      });

      return db.medic.allDocs({ keys: mutedDescendantIds, include_docs: true });
    })
    .then(result => ({
      contacts: result.rows.map(row => row.doc).filter(contact => contact),
      patientIds
    }));
};

const isRelevantForm = doc => doc.form &&
                              doc.type === 'data_record' &&
                              ( isMuteForm(doc.form) || isUnmuteForm(doc.form) ) &&
                              doc.fields &&
                              ( doc.fields.patient_id || doc.fields.place_id );

const isRelevantContact = doc => doc.type !== 'data_record' &&
                                 Boolean(doc.muted) !== mutingUtils.isMuted(doc);

module.exports = {
  init: () => {
    const forms = getConfig()[MUTE_PROPERTY];
    if (!forms || !_.isArray(forms) || !forms.length) {
      throw new Error(`Configuration error. Config must define have a '${CONFIG_NAME}.${MUTE_PROPERTY}' array defined.`);
    }
    mutingUtils.getMutedContactsIds(db.medic, Promise);
  },
  filter: (doc, info = {}) => {
    return doc &&
           (isRelevantForm(doc) || isRelevantContact(doc)) &&
           !transitionUtils.hasRun(info, TRANSITION_NAME);

  },
  onMatch: change => {
    if (isRelevantContact(change.doc)) {
      // fix discrepancy between `muted-contacts` doc and actual muted contacts
      return mutingUtils
        .updateMutedContacts(db.medic, [change.doc], change.doc.muted, Promise)
        .then(() => false);
    }

    const muting = isMuteForm(change.doc.form);
    let targetContact;

    return Promise
      .all([ getContact(change.doc), mutingUtils.getMutedContactsIds(db.medic, Promise, true) ])
      .then(([ contact ]) => {
        return muting ? muteAction(change.doc, contact) : unmuteAction(change.doc, contact);
      })
      .then(result => {
        if (!result) {
          // no contacts or registrations need updating
          return true;
        }

        return mutingUtils
          .updateMutedContacts(db.medic, result.contacts, muting, Promise)
          .then(() => updateContacts(result.contacts, muting))
          .then(() => updateRegistrations(result.patientIds, muting))
          .then(registrations => {
            module.exports._addMsg(getEventType(muting), getConfig(), change.doc, registrations, targetContact);
            return true;
          });
      });
  },
  _addMsg: function(eventType, doc, registrations, contact) {
    const msgConfig = _.findWhere(getConfig().messages, { event_type: eventType });

    if (msgConfig) {
      const templateContext = {
        registrations: registrations,
        patient: contact
      };
      messages.addMessage(doc, msgConfig, msgConfig.recipient, templateContext);
    }

    return true;
  },
  _addErr: function(eventType, doc) {
    const locale = utils.getLocale(doc),
          evConf = _.findWhere(getConfig().messages, { event_type: eventType });

    const msg = messages.getMessage(evConf, locale);
    if (msg) {
      messages.addError(doc, msg);
    } else {
      messages.addError(doc, `Failed to complete muting request, event type "${eventType}" misconfigured.`);
    }

    return true;
  },
};
