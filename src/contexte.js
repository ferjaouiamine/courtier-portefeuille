const { AsyncLocalStorage } = require('async_hooks');

const stockageContexte = new AsyncLocalStorage();

function avecOrganisation(organisationId, fonction) {
  return stockageContexte.run({ organisationId }, fonction);
}

function organisationCourante() {
  return stockageContexte.getStore()?.organisationId || null;
}

module.exports = { avecOrganisation, organisationCourante };
