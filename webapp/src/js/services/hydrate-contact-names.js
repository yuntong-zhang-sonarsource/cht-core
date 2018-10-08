var _ = require('underscore');

angular.module('inboxServices').factory('HydrateContactNames',
  function(
    $q,
    ContactsMuting,
    GetSummaries
  ) {

    'use strict';
    'ngInject';

    var findContactName = function(contactSummaries, id) {
      var cs = _.findWhere(contactSummaries, { _id: id });
      return (cs && cs.name) || null;
    };

    var findContact = function(contactSummaries, id) {
      return _.findWhere(contactSummaries, { _id: id }) || { _id: id };
    };

    var replaceContactIdsWithNames = function(summaries, contactSummaries) {
      summaries.forEach(function(summary) {
        var lineage;
        if (summary.contact) {
          summary.contact = findContactName(contactSummaries, summary.contact);
        }
        if (summary.lineage && summary.lineage.length) {
          lineage = summary.lineage.map(function (id) {
            return findContact(contactSummaries, id);
          });

          summary.lineage = summary.lineage.map(function(id) {
            return findContactName(contactSummaries, id);
          });
        }
        summary.muted = ContactsMuting.isMutedSync(summary, lineage);
      });
      return summaries;
    };

    var relevantIdsFromSummary = function(summary) {
      // Pull lineages as well so we can pull their names out of the summaries
      return [summary.contact].concat(summary.lineage);
    };

    /**
     * Replace contact ids with their names for ids
     */
    return function(summaries) {
      var ids =  _.chain(summaries)
                  .map(relevantIdsFromSummary)
                  .flatten()
                  .compact()
                  .uniq()
                  .value();

      if (!ids.length) {
        return $q.resolve(summaries);
      }

      return $q
        .all([
          GetSummaries(ids),
          ContactsMuting.loadMutedContactsIds()
        ]).then(function(response) {
          return replaceContactIdsWithNames(summaries, response[0]);
        });
    };
  }
);
