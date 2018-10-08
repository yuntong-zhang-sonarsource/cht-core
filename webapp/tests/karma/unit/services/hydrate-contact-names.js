describe('HydrateContactNames service', () => {

  'use strict';

  let service,
      GetSummaries,
      ContactsMuting;

  beforeEach(() => {
    GetSummaries = sinon.stub();
    ContactsMuting = { loadMutedContactsIds: sinon.stub(), isMutedSync: sinon.stub() };
    module('inboxApp');
    module($provide => {
      $provide.value('$q', Q); // bypass $q so we don't have to digest
      $provide.value('GetSummaries', GetSummaries);
      $provide.value('ContactsMuting', ContactsMuting);
    });
    inject($injector => service = $injector.get('HydrateContactNames'));
  });

  it('returns empty array when given no summaries', () => {
    return service([]).then(actual => {
      chai.expect(actual).to.deep.equal([]);
    });
  });

  it('does nothing when summaries not found', () => {
    const given = [{
      contact: 'a',
      lineage: [ 'b', 'c' ]
    }];
    GetSummaries.returns(Promise.resolve([]));
    return service(given).then(actual => {
      chai.expect(actual).to.deep.equal(given);
    });
  });

  it('replaces ids with names', () => {
    const given = [
      { contact: 'a', lineage: [ 'b', 'c' ] },
      { contact: 'd' }
    ];
    const summaries = [
      { _id: 'a', name: 'arnie', age: 15 },
      { _id: 'c', name: 'charlie', colour: 'green' },
      { _id: 'd', name: 'dannie' }
    ];
    GetSummaries.returns(Promise.resolve(summaries));
    return service(given).then(actual => {
      chai.expect(actual[0].contact).to.equal('arnie');
      chai.expect(actual[0].lineage.length).to.equal(2);
      chai.expect(actual[0].lineage[0]).to.equal(null);
      chai.expect(actual[0].lineage[1]).to.equal('charlie');
      chai.expect(actual[1].contact).to.equal('dannie');
      chai.expect(actual[1].lineage).to.equal(undefined);
      chai.expect(GetSummaries.callCount).to.equal(1);
      chai.expect(GetSummaries.args[0][0]).to.deep.equal(['a', 'b', 'c', 'd' ]);
    });
  });

  describe('muted contacts', () => {

    it('should load muted contact IDs', () => {
      GetSummaries.resolves([{ _id: 'a' }]);
      ContactsMuting.loadMutedContactsIds.resolves();

      return service([{ _id: 'b', contact: 'a' }]).then(() => {
        chai.expect(ContactsMuting.loadMutedContactsIds.callCount).to.equal(1);
      });
    });

    it('should retrieve muted state for each summary', () => {
      const given = [
        { contact: 'a', lineage: ['b', 'c'] },
        { contact: 'd', lineage: ['e', 'f', 'g'] },
        { contact: 'e' }
      ];

      const summaries = [
        { _id: 'a', name: 'maisie' },
        { _id: 'b', name: 'george' },
        { _id: 'e', name: 'peanut' },
        { _id: 'f', name: 'mustard' },
        { _id: 'g', name: 'wish'}
      ];

      GetSummaries.resolves(summaries);
      ContactsMuting.isMutedSync
        .withArgs(sinon.match({ contact: 'maisie' })).returns(true)
        .withArgs(sinon.match({ contact: null })).returns(false)
        .withArgs(sinon.match({ contact: 'peanut' })).returns(true);

      return service(given).then(result => {
        chai.expect(result).to.deep.equal([
          { contact: 'maisie', lineage: ['george', null], muted: true },
          { contact: null, lineage: ['peanut', 'mustard', 'wish'], muted: false },
          { contact: 'peanut', muted: true }
        ]);
        chai.expect(ContactsMuting.isMutedSync.callCount).to.equal(3);
        chai.expect(ContactsMuting.isMutedSync.args[0]).to.deep.equal([
          { contact: 'maisie', lineage: ['george', null], muted: true },
          [{ _id: 'b', name: 'george' }, { _id: 'c' }]
        ]);
        chai.expect(ContactsMuting.isMutedSync.args[1]).to.deep.equal([
          { contact: null, lineage: ['peanut', 'mustard', 'wish'], muted: false },
          [{ _id: 'e', name: 'peanut' }, { _id: 'f', name: 'mustard' }, { _id: 'g', name: 'wish' }]
        ]);
        chai.expect(ContactsMuting.isMutedSync.args[2]).to.deep.equal([
          { contact: 'peanut', muted: true },
          undefined
        ]);
      });
    });

    it('should replace missing lineage summary with stub', () => {
      GetSummaries.resolves([
        { _id: 'a', name: 'maria' }
      ]);
      ContactsMuting.isMutedSync.returns(false);
      return service([{ lineage: ['a', 'b', 'c'] }]).then(result => {
        chai.expect(result).to.deep.equal([{ lineage: ['maria', null, null], muted: false }]);
        chai.expect(ContactsMuting.isMutedSync.callCount).to.equal(1);
        chai.expect(ContactsMuting.isMutedSync.args[0][1])
          .to.deep.equal([{ _id: 'a', name: 'maria' }, { _id: 'b' }, { _id: 'c' }]);
      });
    });

    it('should construct correct lineage', () => {
      const given = [
        { contact: 'a', lineage: ['b', 'c', 'd'] },
        { contact: 'b', lineage: ['c', 'd'] },
        { contact: 'e', lineage: ['c', 'd'] },
        { contact: 'f', lineage: ['g', 'h'] }
      ];

      GetSummaries.resolves([
        { _id: 'a', name: 'a-name' },
        { _id: 'b', name: 'b-name' },
        { _id: 'c', name: 'c-name' },
        { _id: 'd', name: 'd-name' },
        { _id: 'e', name: 'e-name' },
        { _id: 'f', name: 'f-name' },
        { _id: 'g', name: 'g-name' },
        { _id: 'h', name: 'h-name' },
      ]);

      return service(given).then(result => {
        chai.expect(result.length).to.equal(4);
        chai.expect(result.every(summary => !summary.muted)).to.equal(true);
        chai.expect(ContactsMuting.isMutedSync.callCount).to.equal(4);
        chai.expect(ContactsMuting.isMutedSync.args[0][1]).to.deep.equal([
          { _id: 'b', name: 'b-name' },
          { _id: 'c', name: 'c-name' },
          { _id: 'd', name: 'd-name' }
        ]);

        chai.expect(ContactsMuting.isMutedSync.args[1][1]).to.deep.equal([
          { _id: 'c', name: 'c-name' },
          { _id: 'd', name: 'd-name' }
        ]);

        chai.expect(ContactsMuting.isMutedSync.args[2][1]).to.deep.equal([
          { _id: 'c', name: 'c-name' },
          { _id: 'd', name: 'd-name' }
        ]);

        chai.expect(ContactsMuting.isMutedSync.args[3][1]).to.deep.equal([
          { _id: 'g', name: 'g-name' },
          { _id: 'h', name: 'h-name' }
        ]);
      });
    });
  });
});
