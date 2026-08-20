const path = require("path");
const fs = require("fs");

const storageRoot = path.join(__dirname);

fs.mkdirSync(path.join(storageRoot, "videos"), {
  recursive: true
});

fs.mkdirSync(path.join(storageRoot, "thumbnails"), {
  recursive: true
});

module.exports = {
  storageRoot
};