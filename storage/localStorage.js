const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');

const VIDEO_DIR = 'videos';
const THUMBNAIL_DIR = 'thumbnails';

const MIME_EXTENSIONS = new Map([
  ['video/mp4', '.mp4'],
  ['video/webm', '.webm'],
  ['video/quicktime', '.mov'],
  ['video/x-matroska', '.mkv'],
  ['video/ogg', '.ogv'],
  ['image/jpeg', '.jpg'],
  ['image/jpg', '.jpg'],
  ['image/png', '.png'],
  ['image/webp', '.webp']
]);

function createLocalStorage(options = {}) {
  const storageRoot = path.resolve(options.storageRoot || path.join(__dirname, '..', 'uploads'));
  const publicBasePath = options.publicBasePath || '/uploads';

  function extensionFor(file) {
    const fromMime = MIME_EXTENSIONS.get(file.mimetype);
    if (fromMime) return fromMime;

    const ext = path.extname(file.originalname || '').toLowerCase();
    return /^[a-z0-9.]+$/.test(ext) ? ext : '';
  }

  async function ensureDirectory(kind) {
    const targetDir = path.resolve(storageRoot, kind);
    if (!targetDir.startsWith(storageRoot)) {
      throw new Error('Geçersiz storage dizini.');
    }
    await fs.mkdir(targetDir, { recursive: true });
    return targetDir;
  }

  async function saveFile(file, kind) {
    if (!file || !file.buffer) {
      throw new Error('Kaydedilecek dosya bulunamadı.');
    }

    const targetDir = await ensureDirectory(kind);
    const filename = `${crypto.randomUUID()}${extensionFor(file)}`;
    const absolutePath = path.resolve(targetDir, filename);

    if (!absolutePath.startsWith(targetDir)) {
      throw new Error('Geçersiz dosya yolu.');
    }

    await fs.writeFile(absolutePath, file.buffer, { flag: 'wx' });
    return {
      provider: 'local',
      key: `${kind}/${filename}`,
      filename: `uploads/${kind}/${filename}`,
      path: absolutePath,
      url: `${publicBasePath}/${kind}/${filename}`
    };
  }

  async function deleteFile(key) {
    if (!key) return;
    const normalizedKey = String(key).replace(/^\/?uploads\//, '');
    const absolutePath = path.resolve(storageRoot, normalizedKey);

    if (!absolutePath.startsWith(storageRoot)) {
      throw new Error('Geçersiz silme yolu.');
    }

    await fs.rm(absolutePath, { force: true });
  }

  return {
    provider: 'local',
    storageRoot,
    publicBasePath,
    saveVideo: (file) => saveFile(file, VIDEO_DIR),
    saveThumbnail: (file) => saveFile(file, THUMBNAIL_DIR),
    deleteVideo: deleteFile,
    deleteThumbnail: deleteFile,
    getVideoUrl: (keyOrUrl) => {
      if (!keyOrUrl) return null;
      if (/^https?:\/\//i.test(keyOrUrl)) return keyOrUrl;
      const key = String(keyOrUrl).replace(/^\/?uploads\//, '');
      return `${publicBasePath}/${key}`.replace(/\\/g, '/');
    },
    getThumbnailUrl: (keyOrUrl) => {
      if (!keyOrUrl) return null;
      if (/^https?:\/\//i.test(keyOrUrl)) return keyOrUrl;
      const key = String(keyOrUrl).replace(/^\/?uploads\//, '');
      return `${publicBasePath}/${key}`.replace(/\\/g, '/');
    }
  };
}

module.exports = createLocalStorage;
