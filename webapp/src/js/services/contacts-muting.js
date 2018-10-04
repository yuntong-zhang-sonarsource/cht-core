var mutingUtils = require('@shared-libs/muting-utils');

angular.module('inboxServices').factory('ContactsMutingUtils', function() {

  'use strict';
  'ngInject';

  return mutingUtils;
});


angular.module('inboxServices').factory('ContactsMuting',
  function(
    $log,
    $q,
    Changes,
    ContactsMutingUtils,
    DB
  ) {

    'use strict';
    'ngInject';

    var inited = false;

    var init = function(refresh) {
      if (!refresh && inited) {
        return $q.resolve();
      }

      return ContactsMutingUtils.getMutedContactsIds(DB(), $q).then(function() {
        inited = true;
      });
    };

    var isMutedContactsChange = function(change) {
      return change.id === ContactsMutingUtils.MUTED_CONTACTS_DOC_ID;
    };

    Changes({
      key: 'contacts-muting-service',
      filter: isMutedContactsChange,
      callback: function() {
        return init(true);
      }
    });

    return {
      loadMutedContactsIds: init,

      isUnmuteForm: function(settings, formId) {
        return settings &&
               settings.muting &&
               settings.muting.unmute_forms &&
               settings.muting.unmute_forms.includes(formId);
      },

      isMuted: function(doc, lineage) {
        return init().then(function() {
          return ContactsMutingUtils.isMuted(doc, lineage);
        });
      },

      isMutedSync: function(doc, lineage) {
        return ContactsMutingUtils.isMuted(doc, lineage);
      },

      isMutedContactsChange: isMutedContactsChange
    };
  }
);
