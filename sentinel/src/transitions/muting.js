const _ = require('underscore'),
      config = require('../config'),
      transitionUtils = require('./utils'),
      db = require('../db-nano'),
      utils = require('utils');

const TRANSITION_NAME = 'muting',
      CONFIG_NAME = 'muting',
      MUTE_PROPERTY = 'mute_forms',
      UNMUTE_PROPERTY = 'unmute_forms';


const getConfig = () => {
  return config.get(CONFIG_NAME) || {};
};

const isMuteForm = form => {
  return getConfig[MUTE_PROPERTY].includes(form);
};

const isUnmuteForm = form => {
  const unmuteForms = getConfig[UNMUTE_PROPERTY];
  return unmuteForms && unmuteForms.includes(form);
};

const getContact = doc => {
  const contactId = doc.fields.patient_id || doc.fields.place_id;

  return new Promise((resolve, reject) => {
    const callback = (err, contact) => {
      return err ? reject(err) : resolve(contact);
    };

    db.medic.get(contactId, (err, patient) => {
      if (err && err.statusCode !== 404) {
        return callback(err);
      }
      if (patient) {
        return callback(null, patient);
      }
      // no contact found - maybe the ID is a shortcode...
      utils.getPatientContact(db, contactId, callback);
    });
  });
};

module.exports = {
  init: () => {
    const forms = getConfig()[MUTE_PROPERTY];
    if (!forms || !_.isArray(forms) || !forms.length) {
      throw new Error(`Configuration error. Config must define have a '${CONFIG_NAME}.${MUTE_PROPERTY}' array defined.`);
    }
  },
  filter: (doc, info = {}) => {
    return doc &&
           doc.form &&
           doc.type === 'data_record' &&
           ( isMuteForm(doc.form) || isUnmuteForm(doc.form) ) &&
           doc.fields &&
           ( doc.fields.patient_id || doc.fields.place_id ) &&
           !transitionUtils.hasRun(info, TRANSITION_NAME);
  },
  onMatch: change => {
    getContact(change.doc).then(contact => {

    });
  }
};
