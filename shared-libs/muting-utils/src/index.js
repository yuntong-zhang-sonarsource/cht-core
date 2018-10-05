var mutedContactsIds = [],
    inited = false;

var getMutedContactsDoc = function(DB) {
  return DB
    .get(module.exports.MUTED_CONTACTS_DOC_ID)
    .catch(function(err) {
      if (err && err.status === 404) {
        return { _id: module.exports.MUTED_CONTACTS_DOC_ID, muted_contacts: [] };
      }

      throw(err);
    });
};

var addMutedContactIds = function(DB, contactIds) {
  return getMutedContactsDoc(DB).then(function(doc) {
    contactIds.forEach(function(contactId) {
      if (doc.muted_contacts.indexOf(contactId) === -1) {
        doc.muted_contacts.push(contactId);
      }
    });

    mutedContactsIds = doc.muted_contacts;
    return DB.put(doc);
  });
};

var removeMutedContactIds = function(DB, contactIds) {
  return getMutedContactsDoc(DB).then(function(doc) {
    contactIds.forEach(function(contactId) {
      var idx = doc.muted_contacts.indexOf(contactId);
      if (idx !== -1) {
        doc.muted_contacts.splice(idx, 1);
      }
    });

    mutedContactsIds = doc.muted_contacts;
    return DB.put(doc);
  });
};

module.exports = {
  MUTED_CONTACTS_DOC_ID: 'muted-contacts',

  // loads `muted-contacts` doc, stores and returns muted contacts list
  getMutedContactsIds: function(DB, Promise, refresh) {
    if (!refresh && inited) {
      return Promise.resolve(mutedContactsIds);
    }

    return getMutedContactsDoc(DB).then(function(doc) {
      mutedContactsIds = doc.muted_contacts;
      inited = true;
      return mutedContactsIds;
    });
  },

  // returns whether a contact is muted
  // accepts lineage as an object property (via `parent`) or as an array parameter
  // not hydrated docs are checked against the muted-contacts doc list
  isMuted: function(contact, lineage) {
    var isMutedDoc = function(doc) {
      return doc && ( doc.muted || mutedContactsIds.includes(doc._id) );
    };

    var isMutedInLineage = function(doc) {
      return !!(doc && (isMutedDoc(doc) || isMutedInLineage(doc.parent)));
    };

    if (lineage) {
      return isMutedDoc(contact) || !!lineage.find(function(parent) {
        return isMutedDoc(parent);
      });
    }

    return isMutedInLineage(contact);
  },

  // updates muted-contacts list by adding/removing provided contact ids
  updateMutedContacts: function(DB, contacts, muted, Promise) {
    if (!contacts || !contacts.length) {
      return Promise.resolve();
    }

    var contactIds = contacts.map(function(contact) {
      return contact._id;
    });
    return muted ? addMutedContactIds(DB, contactIds) : removeMutedContactIds(DB, contactIds);
  },

  _reset: function() {
    inited = false;
  }
};
