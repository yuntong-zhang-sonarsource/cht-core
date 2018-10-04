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

  describe('loadMutedContactsIds', () => {
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

  });
});
