describe('Contacts service', () => {

  'use strict';

  let service,
      ContactsMutingUtils,
      Changes,
      changesKey,
      changesFilter,
      changesCallback;

  beforeEach(() => {
    module('inboxApp');
    ContactsMutingUtils = {
      MUTED_CONTACTS_DOC_ID: 'muted-contacts',
      getMutedContactsIds: sinon.stub(),
      isMuted: sinon.stub()
    };
    Changes = sinon.stub().callsFake(opts => {
      changesKey = opts.key;
      changesFilter = opts.filter;
      changesCallback = opts.callback;
    });
    module($provide => {
      $provide.factory('DB', KarmaUtils.mockDB({}));
      $provide.value('Changes', Changes);
      $provide.value('ContactsMutingUtils', ContactsMutingUtils);
      $provide.value('$q', Q); // bypass $q so we don't have to digest
    });
    inject($injector => {
      service = $injector.get('ContactsMuting');
    });
  });

  afterEach(() => sinon.restore());

  it('should register changes listener on init', () => {
    ContactsMutingUtils.getMutedContactsIds.resolves();

    return service.loadMutedContactsIds().then(() => {
      chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(1);
      chai.expect(ContactsMutingUtils.getMutedContactsIds.args[0]).to.deep.equal([ {}, Q, undefined, undefined ]);

      chai.expect(Changes.callCount).to.equal(1);
      chai.expect(changesKey).to.equal('contacts-muting-service');
      chai.expect(changesFilter).to.be.a('function');
      chai.expect(changesCallback).to.be.a('function');

      chai.expect(changesFilter({ id: 'muted-contacts' })).to.equal(true);
      chai.expect(changesFilter({ id: 'other' })).to.equal(false);

      return changesCallback({ doc: { _id: 'muted-contacts' } }).then(() => {
        chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(2);
        chai.expect(ContactsMutingUtils.getMutedContactsIds.args[1])
          .to.deep.equal([ {}, Q, true, { _id: 'muted-contacts' } ]);
      });
    });
  });

  describe('loadMutedContactsIds', () => {
    it('should load muted contactIds in library', () => {
      ContactsMutingUtils.getMutedContactsIds.resolves();
      return service.loadMutedContactsIds().then(() => {
        chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(1);
        chai.expect(ContactsMutingUtils.getMutedContactsIds.args[0]).to.deep.equal([ {}, Q, undefined, undefined ]);
      });
    });

    it('should not load when already loaded', () => {
      ContactsMutingUtils.getMutedContactsIds.resolves();
      return service.loadMutedContactsIds()
        .then(() => {
          chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(1);
          chai.expect(ContactsMutingUtils.getMutedContactsIds.args[0]).to.deep.equal([ {}, Q, undefined, undefined ]);
          return service.loadMutedContactsIds();
        })
        .then(() => {
          chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(1);
        });
    });

    it('should reload when forced', () => {
      ContactsMutingUtils.getMutedContactsIds.resolves();
      return service.loadMutedContactsIds()
        .then(() => {
          chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(1);
          chai.expect(ContactsMutingUtils.getMutedContactsIds.args[0]).to.deep.equal([ {}, Q, undefined, undefined ]);
          return service.loadMutedContactsIds(true);
        })
        .then(() => {
          chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(2);
          chai.expect(ContactsMutingUtils.getMutedContactsIds.args[1]).to.deep.equal([ {}, Q, true, undefined ]);
        });
    });
  });

  describe('isUnmuteForm', () => {
    it('should return false when no settings', () => {
      chai.expect(service.isUnmuteForm()).to.equal(false);
      chai.expect(service.isUnmuteForm({})).to.equal(false);
      chai.expect(service.isUnmuteForm({ foo: 'bar' })).to.equal(false);
      chai.expect(service.isUnmuteForm({ muting: 'bar' })).to.equal(false);
    });

    it('should return false when no formId', () => {
      const settings = {
        muting: {
          unmute_forms: ['unmute-person']
        }
      };

      chai.expect(service.isUnmuteForm(settings)).to.equal(false);
    });

    it('should return false when form is not unmute form', () => {
      const settings = {
        muting: {
          unmute_forms: ['unmute-person', 'unmute-clinic', 'unmute-district']
        }
      };

      chai.expect(service.isUnmuteForm(settings, 'someFormId')).to.equal(false);
    });

    it('should return true when form is unmute form', () => {
      const settings = {
        muting: {
          unmute_forms: ['unmute-person', 'unmute-clinic', 'unmute-district']
        }
      };

      chai.expect(service.isUnmuteForm(settings, 'unmute-person')).to.equal(true);
      chai.expect(service.isUnmuteForm(settings, 'unmute-clinic')).to.equal(true);
      chai.expect(service.isUnmuteForm(settings, 'unmute-district')).to.equal(true);
    });
  });

  describe('isMuted', () => {
    it('should init', () => {
      ContactsMutingUtils.getMutedContactsIds.resolves();
      ContactsMutingUtils.isMuted.returns(false);

      return service.isMuted({}).then(result => {
        chai.expect(result).to.equal(false);
        chai.expect(ContactsMutingUtils.getMutedContactsIds.callCount).to.equal(1);
        chai.expect(ContactsMutingUtils.isMuted.callCount).to.equal(1);
        chai.expect(ContactsMutingUtils.isMuted.args[0]).to.deep.equal([{}, undefined]);
      });
    });

    it('should call library with correct arguments', () => {
      ContactsMutingUtils.getMutedContactsIds.resolves();
      ContactsMutingUtils.isMuted.returns(false);

      return service.isMuted({ _id: '123'}, 'lineage').then(result => {
        chai.expect(result).to.equal(false);
        chai.expect(ContactsMutingUtils.isMuted.callCount).to.equal(1);
        chai.expect(ContactsMutingUtils.isMuted.args[0]).to.deep.equal([{ _id: '123'}, 'lineage']);
      });
    });

    it('should return result from lib call', () => {
      ContactsMutingUtils.getMutedContactsIds.resolves();
      ContactsMutingUtils.isMuted.returns('some random result');

      return service.isMuted('test').then(result => {
        chai.expect(result).to.equal('some random result');
        chai.expect(ContactsMutingUtils.isMuted.args[0]).to.deep.equal(['test', undefined]);
      });
    });
  });

  describe('isMutedSync', () => {
    it('should call library with correct arguments', () => {
      ContactsMutingUtils.isMuted.returns(false);

      service.isMutedSync('the doc', 'the lineage');
      service.isMutedSync({ _id: '1234'});

      chai.expect(ContactsMutingUtils.isMuted.callCount).to.equal(2);
      chai.expect(ContactsMutingUtils.isMuted.args[0]).to.deep.equal(['the doc', 'the lineage']);
      chai.expect(ContactsMutingUtils.isMuted.args[1]).to.deep.equal([{ _id: '1234'}, undefined]);
    });

    it('should return result from lib call', () => {
      ContactsMutingUtils.isMuted.withArgs({ _id: 1}).returns(true);
      ContactsMutingUtils.isMuted.withArgs({ _id: 2}).returns(false);
      ContactsMutingUtils.isMuted.withArgs({ _id: 3}).returns('relay');

      chai.expect(service.isMutedSync({ _id: 1 })).to.equal(true);
      chai.expect(service.isMutedSync({ _id: 2 })).to.equal(false);
      chai.expect(service.isMutedSync({ _id: 3 })).to.equal('relay');
    });
  });
});
