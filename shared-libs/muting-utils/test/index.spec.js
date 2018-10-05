const sinon = require('sinon').sandbox.create(),
      chai = require('chai'),
      utils = require('../src/index');

let db;

describe('mutingUtils', () => {
  afterEach(() => {
    utils._reset();
    sinon.restore();
  });

  beforeEach(() => {
    db = { get: sinon.stub(), put: sinon.stub() };
  });

  describe('getMutedContactsIds', () => {
    it('should return correct doc Id', () => {
      chai.expect(utils.MUTED_CONTACTS_DOC_ID).to.equal('muted-contacts');
    });

    it('should query the DB for the correct document ID', () => {
      db.get.resolves({});

      return utils.getMutedContactsIds(db, Promise).then(() => {
        chai.expect(db.get.callCount).to.equal(1);
        chai.expect(db.put.callCount).to.equal(0);
        chai.expect(db.get.args[0]).to.deep.equal([ 'muted-contacts' ]);
      });
    });

    it('should catch db 404 errors', () => {
      db.get.rejects({ status: 404 });

      return utils.getMutedContactsIds(db, Promise).then(result => {
        chai.expect(db.get.callCount).to.equal(1);
        chai.expect(db.put.callCount).to.equal(0);

        chai.expect(result).to.deep.equal([]);
      });
    });

    it('should throw other db errors', () => {
      db.get.rejects({ some: 'error' });

      return utils.getMutedContactsIds(db, Promise)
        .then(() => chai.expect(false).to.equal(true))
        .catch(err => chai.expect(err).to.deep.equal({ some: 'error' }));
    });

    it('should return muted contacts ids', () => {
      db.get.resolves({ muted_contacts: [1, 2, 3] });
      return utils.getMutedContactsIds(db, Promise).then(result => {
        chai.expect(result).to.deep.equal([1, 2, 3]);
      });
    });

    it('should not query when muted contacts are already loaded', () => {
      db.get.resolves({ muted_contacts: [1, 2, 3] });
      return utils.getMutedContactsIds(db, Promise)
        .then(result => {
          chai.expect(db.get.callCount).to.equal(1);
          chai.expect(result).to.deep.equal([1, 2, 3]);
          return utils.getMutedContactsIds(db, Promise);
        })
        .then(result => {
          chai.expect(result).to.deep.equal([1, 2, 3]);
          chai.expect(db.get.callCount).to.equal(1);
        });
    });

    it('should query when contacts are already loaded when refresh is requested', () => {
      db.get.onFirstCall().resolves({ muted_contacts: [1, 2, 3] });
      db.get.onSecondCall().resolves({ muted_contacts: [4, 5, 6] });

      return utils.getMutedContactsIds(db, Promise)
        .then(result => {
          chai.expect(db.get.callCount).to.equal(1);
          chai.expect(result).to.deep.equal([1, 2, 3]);
          return utils.getMutedContactsIds(db, Promise, true);
        })
        .then(result => {
          chai.expect(result).to.deep.equal([4, 5, 6]);
          chai.expect(db.get.callCount).to.equal(2);
        });
    });
  });

  describe('isMuted', () => {
    it('should work when contact is falsey', () => {
      chai.expect(utils.isMuted(false)).to.equal(false);
      chai.expect(utils.isMuted(false, false)).to.equal(false);
    });

    it('should work for hydrated contacts', () => {
      const contact = {
        muted: false,
        parent: {
          muted: false,
          parent: {
            muted: true,
            parent: {
              parent: {
                muted: false
              }
            }
          }
        }
      };
      chai.expect(utils.isMuted(contact)).to.equal(true);
      contact.parent.parent.muted = false;
      chai.expect(utils.isMuted(contact)).to.equal(false);

      chai.expect(utils.isMuted({ muted: true })).to.equal(true);
      chai.expect(utils.isMuted({ })).to.equal(false);
    });

    it('should work with hydrated array lineage', () => {
      const contact = { _id: 'ct' },
            lineage = [
              { _id: 'p1', muted: false },
              { _id: 'p2' },
              { _id: 'p3', muted: true },
              { muted: false }
            ];

      chai.expect(utils.isMuted(contact, lineage)).to.equal(true);
      lineage[2].muted = false;
      chai.expect(utils.isMuted(contact, lineage)).to.equal(false);
    });

    it('should work for unhydrated docs when muted-contacts are loaded', () => {
      db.get.resolves({ muted_contacts: ['m1', 'm2', 'm3'] });

      const contact = {
        _id: 'p1',
        parent: {
          _id: 'p2',
          parent: {
            _id: 'p3',
            parent: {
              _id: 'm2',
              parent: {
                _id: 'p5'
              }
            }
          }
        }
      };

      return utils.getMutedContactsIds(db, Promise).then(() => {
        chai.expect(utils.isMuted({ _id: 'm1' })).to.equal(true);
        chai.expect(utils.isMuted({ _id: 'other' })).to.equal(false);
        chai.expect(utils.isMuted(contact)).to.equal(true);

        contact.parent.parent.parent._id = 'not-m2';
        chai.expect(utils.isMuted(contact)).to.equal(false);
      });
    });

    it('should work for unkydrated docs with array lineage when muted-contacts are loaded', () => {
      db.get.resolves({ muted_contacts: ['m1', 'm2', 'm3'] });

      return utils.getMutedContactsIds(db, Promise).then(() => {
        chai.expect(utils.isMuted({ _id: 'p1' }, [{ _id: 'p2' }, { _id: 'p3' }])).to.equal(false);
        chai.expect(utils.isMuted({ _id: 'p1' }, [{ _id: 'p2' }, { _id: 'p3' }, { _id: 'm3' }])).to.equal(true);
        chai.expect(utils.isMuted({ _id: 'p1' }, [{ _id: 'm2' }, { _id: 'p3' }, { _id: 'm3' }])).to.equal(true);
        chai.expect(utils.isMuted({ _id: 'm1' }, [{ _id: 'p1' }, { _id: 'p3' }, { _id: 'p2' }])).to.equal(true);
      });
    });
  });

  describe('updateMutedContacts', () => {
    it('should throw db errors', () => {
      db.get.rejects({ some: 'error' });

      return utils.updateMutedContacts(db, [{ _id: 1 }], false, Promise)
        .then(() => chai.expect(false).to.equal(true))
        .catch(err => chai.expect(err).to.deep.equal({ some: 'error' }));
    });

    it('should work with empty contacts list', () => {
      return utils.updateMutedContacts(db, false, false, Promise).then(result => {
        chai.expect(result).to.equal(undefined);
        chai.expect(db.get.callCount).to.equal(0);
        chai.expect(db.put.callCount).to.equal(0);
      });
    });

    it('should create muted-contacts doc when not existent', () => {
      db.get.rejects({ status: 404 });
      db.put.resolves({ ok: true });

      return utils
        .updateMutedContacts(db, [{ _id: 1 }, { _id: 2 }, { _id: 3 }], true, Promise)
        .then(result => {
          chai.expect(result).to.deep.equal({ ok: true });
          chai.expect(db.get.callCount).to.equal(1);
          chai.expect(db.get.args[0]).to.deep.equal(['muted-contacts']);
          chai.expect(db.put.callCount).to.equal(1);
          chai.expect(db.put.args[0]).to.deep.equal([{ _id: 'muted-contacts', muted_contacts: [1, 2, 3] }]);
        });
    });

    it('should add new contacts to the muted contacts list', () => {
      db.get.resolves({ muted_contacts: [1, 2, 3, 4, 5] });
      db.put.resolves({ ok: true });

      return utils
        .updateMutedContacts(db, [{ _id: 2 }, { _id: 16 }, { _id: 5 }, { _id: 21 }, { _id: 16 }], true, Promise)
        .then(result => {
          chai.expect(result).to.deep.equal({ ok: true });
          chai.expect(db.get.callCount).to.equal(1);
          chai.expect(db.put.callCount).to.equal(1);
          chai.expect(db.put.args[0]).to.deep.equal([{ muted_contacts: [1, 2, 3, 4, 5, 16, 21] }]);
        });
    });

    it('should remove contacts from the muted contacts list', () => {
      db.get.resolves({ muted_contacts: [1, 2, 3, 4, 5] });
      db.put.resolves({ ok: true });
      return utils
        .updateMutedContacts(db, [{ _id: 2 }, { _id: 16 }, { _id: 5 }, { _id: 21 }], false, Promise)
        .then(result => {
          chai.expect(result).to.deep.equal({ ok: true });
          chai.expect(db.get.callCount).to.equal(1);
          chai.expect(db.put.callCount).to.equal(1);
          chai.expect(db.put.args[0]).to.deep.equal([{ muted_contacts: [1, 3, 4] }]);
        });
    });
  });
});
