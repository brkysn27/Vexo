const path = require('path');
const createLocalStorage = require('./localStorage');

const provider = process.env.STORAGE_PROVIDER || 'local';

function createStorage() {
  if (provider !== 'local') {
    throw new Error(`Desteklenmeyen STORAGE_PROVIDER: ${provider}`);
  }

  return createLocalStorage({
    storageRoot: process.env.LOCAL_STORAGE_ROOT || path.join(__dirname, '..', 'uploads'),
    publicBasePath: process.env.LOCAL_STORAGE_PUBLIC_PATH || '/uploads'
  });
}

module.exports = createStorage();
