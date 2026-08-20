const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);
const sqlite3 = require('sqlite3').verbose();

const app = express();

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const DB_PATH = path.join(ROOT, 'database.db');
const PUBLIC_DIR = path.join(ROOT, 'public');

const UPLOAD_DIR = path.join(ROOT, 'uploads');
const VIDEO_DIR = path.join(UPLOAD_DIR, 'videos');
const THUMBNAIL_DIR = path.join(UPLOAD_DIR, 'thumbnails');

const MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_THUMBNAIL_SIZE = 5 * 1024 * 1024;

const ALLOWED_VIDEO_TYPES = new Set([
  'video/mp4',
  'video/webm',
  'video/quicktime',
  'video/x-matroska',
  'video/ogg'
]);

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/jpg'
]);

/* =========================================================
   KLASÖRLER
========================================================= */

for (const dir of [
  UPLOAD_DIR,
  VIDEO_DIR,
  THUMBNAIL_DIR
]) {
  fs.mkdirSync(dir, { recursive: true });
}

/* =========================================================
   DATABASE
========================================================= */

const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) {
    console.error('SQLite bağlantısı kurulamadı:', err.message);
    process.exit(1);
  }

  console.log('SQLite veritabanı açıldı:', DB_PATH);
});

/* =========================================================
   MULTER STORAGE
========================================================= */

const uploadStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    if (file.fieldname === 'thumbnail') {
      cb(null, THUMBNAIL_DIR);
    } else {
      cb(null, VIDEO_DIR);
    }
  },

  filename: (req, file, cb) => {
    const safeOriginal = file.originalname
      .replace(/[^a-zA-Z0-9._-]/g, '_');

    let ext = path.extname(safeOriginal);

    if (!ext) {
      ext = file.fieldname === 'thumbnail'
        ? '.jpg'
        : '.mp4';
    }

    const uniqueName =
      `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;

    cb(null, uniqueName);
  }
});

const uploadMiddleware = multer({
  storage: uploadStorage,

  limits: {
    fileSize: MAX_VIDEO_SIZE
  },

  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'thumbnail') {
      if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
        return cb(
          new Error(
            'Desteklenmeyen görsel türü. JPG, JPEG, PNG veya WEBP kullanın.'
          )
        );
      }

      return cb(null, true);
    }

    if (!ALLOWED_VIDEO_TYPES.has(file.mimetype)) {
      return cb(
        new Error(
          'Desteklenmeyen video türü. MP4, WebM, MOV, MKV veya OGG kullanın.'
        )
      );
    }

    cb(null, true);
  }
});

/* =========================================================
   YARDIMCI FONKSİYONLAR
========================================================= */

function sanitizeText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .trim()
    .replace(/\s+/g, ' ');
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.status(401).json({
      error: 'Bu işlem için giriş yapmanız gereklidir.'
    });
  }

  next();
}

function getSafePublicPath(filePath) {
  if (!filePath) {
    return null;
  }

  if (/^https?:\/\//i.test(filePath)) {
    return filePath;
  }

  return filePath.startsWith('/')
    ? filePath
    : `/${filePath}`;
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) {
        return reject(err);
      }

      resolve({
        id: this.lastID,
        changes: this.changes
      });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) {
        return reject(err);
      }

      resolve(row || null);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        return reject(err);
      }

      resolve(rows || []);
    });
  });
}

/* =========================================================
   MODERASYON
========================================================= */

function normalizeModerationText(value) {
  return String(value || '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c')
    .replace(/ğ/g, 'g')
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ş/g, 's')
    .replace(/ü/g, 'u')
    .replace(/[^a-z0-9]/g, '');
}

/*
  Buradaki liste örnektir.
  Yanlış pozitifleri azaltmak için listeyi zamanla
  kendi moderasyon sistemine göre düzenleyebilirsin.
*/
const PROFANITY_PATTERNS = [
  'amk',
  'aq',
  'sik',
  'siktir',
  'orospu',
  'yarrak',
  'pic',
  'ibne'
];

function detectModerationViolation(text) {
  const raw = String(text || '');
  const normalized = normalizeModerationText(raw);

  const profanity = PROFANITY_PATTERNS.some(
    (word) => normalized.includes(word)
  );

  if (profanity) {
    return {
      type: 'profanity',
      reason: 'Uygunsuz ifade tespit edildi.'
    };
  }

  const urlCount =
    (raw.match(/https?:\/\/|www\./gi) || []).length;

  if (urlCount >= 3) {
    return {
      type: 'spam',
      reason: 'Çok fazla bağlantı içeren spam tespit edildi.'
    };
  }

  if (/(.)\1{7,}/u.test(raw)) {
    return {
      type: 'spam',
      reason: 'Tekrarlı karakterlerden oluşan spam tespit edildi.'
    };
  }

  const upperCount =
    raw.replace(/[^A-ZÇĞİÖŞÜ]/g, '').length;

  if (
    raw.length >= 12 &&
    upperCount / Math.max(raw.length, 1) > 0.75
  ) {
    return {
      type: 'spam',
      reason: 'Aşırı büyük harf kullanımı spam olarak değerlendirildi.'
    };
  }

  return null;
}

/* =========================================================
   DATABASE INITIALIZATION
========================================================= */

async function initializeDatabase() {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      filename TEXT NOT NULL,
      thumbnail TEXT,
      category TEXT,
      views INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      comment TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (video_id)
        REFERENCES videos(id)
        ON DELETE CASCADE,
      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS likes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      video_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(video_id, user_id),
      FOREIGN KEY (video_id)
        REFERENCES videos(id)
        ON DELETE CASCADE,
      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subscriber_id INTEGER NOT NULL,
      channel_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subscriber_id, channel_id),
      FOREIGN KEY (subscriber_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
      FOREIGN KEY (channel_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  await dbRun(`
    CREATE TABLE IF NOT EXISTS moderation (
      user_id INTEGER PRIMARY KEY,
      strikes INTEGER NOT NULL DEFAULT 0,
      blocked_until INTEGER NOT NULL DEFAULT 0,
      last_flagged_at TEXT,
      FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
    )
  `);

  /* =======================================================
     DEMO USER
  ======================================================= */

  const demoEmail = 'demo@vexo.local';

  let demoUser = await dbGet(
    'SELECT * FROM users WHERE email = ?',
    [demoEmail]
  );

  if (!demoUser) {
    const hashedPassword = await bcrypt.hash(
      'demo123',
      10
    );

    const result = await dbRun(
      `
      INSERT INTO users
      (
        username,
        email,
        password_hash,
        created_at
      )
      VALUES (?, ?, ?, ?)
      `,
      [
        'Vexo Studio',
        demoEmail,
        hashedPassword,
        new Date().toISOString()
      ]
    );

    demoUser = {
      id: result.id,
      username: 'Vexo Studio',
      email: demoEmail
    };
  }

  /* =======================================================
     DEMO VIDEOS
  ======================================================= */

  const demoVideos = [
    {
      user_id: demoUser.id,
      title: 'Neon Sokak Yansımaları',
      description:
        'Gece şehrin parlayan yüzeyleri, neon vurgu ve akıcı hareketin altında büyüyen teknoloji temalı bir kısa video.',
      filename:
        'https://samplelib.com/preview/mp4/sample-5s.mp4',
      thumbnail:
        'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?auto=format&fit=crop&w=900&q=80',
      category: 'Teknoloji',
      views: 1284
    },

    {
      user_id: demoUser.id,
      title: 'Minimal Studio Akışı',
      description:
        'Temiz kompozisyon, yumuşak ışık akışı ve yaratıcı üretim sürecini öne çıkaran minimal stüdyo deneyimi.',
      filename:
        'https://samplelib.com/preview/mp4/sample-10s.mp4',
      thumbnail:
        'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=900&q=80',
      category: 'Yaratıcılık',
      views: 639
    },

    {
      user_id: demoUser.id,
      title: 'Kinetic Light Pulse',
      description:
        'Enerjik, yüksek kontrastlı ve deneysel bir görsel akış; dinamik ışık desenleri ve teknoloji estetiği.',
      filename:
        'https://samplelib.com/preview/mp4/sample-20s.mp4',
      thumbnail:
        'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=80',
      category: 'Ritim',
      views: 482
    }
  ];

  const existingDemoVideos = await dbAll(
    'SELECT title FROM videos WHERE user_id = ?',
    [demoUser.id]
  );

  const existingTitles = new Set(
    existingDemoVideos.map(
      (video) => video.title
    )
  );

  for (const video of demoVideos) {
    if (existingTitles.has(video.title)) {
      await dbRun(
        `
        UPDATE videos
        SET
          description = ?,
          filename = ?,
          thumbnail = ?,
          category = ?,
          views = ?
        WHERE
          user_id = ?
          AND title = ?
        `,
        [
          video.description,
          video.filename,
          video.thumbnail,
          video.category,
          video.views,
          video.user_id,
          video.title
        ]
      );
    } else {
      await dbRun(
        `
        INSERT INTO videos
        (
          user_id,
          title,
          description,
          filename,
          thumbnail,
          category,
          views,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          video.user_id,
          video.title,
          video.description,
          video.filename,
          video.thumbnail,
          video.category,
          video.views,
          new Date().toISOString()
        ]
      );
    }
  }
}

/* =========================================================
   EXPRESS
========================================================= */

app.use(
  express.json({
    limit: '2mb'
  })
);

app.use(
  express.urlencoded({
    extended: true
  })
);

/* =========================================================
   SESSION
========================================================= */

app.use(
  session({
    store: new SQLiteStore({
      db: 'sessions.db',
      dir: ROOT
    }),

    secret:
      process.env.SESSION_SECRET ||
      'vexo-secret-session-key',

    resave: false,

    saveUninitialized: false,

    cookie: {
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      maxAge:
        1000 *
        60 *
        60 *
        24 *
        30
    }
  })
);

/* =========================================================
   STATIC
========================================================= */

app.use(
  '/uploads',
  express.static(UPLOAD_DIR)
);

app.use(
  express.static(PUBLIC_DIR)
);

/* =========================================================
   SESSION
========================================================= */

app.get('/api/session', (req, res) => {
  if (!req.session.userId) {
    return res.json({
      user: null
    });
  }

  res.json({
    user: {
      id: req.session.userId,
      username: req.session.username,
      email: req.session.email
    }
  });
});

/* =========================================================
   VIDEOS
========================================================= */

app.get('/api/videos', async (req, res) => {
  try {
    const videos = await dbAll(`
      SELECT
        v.*,
        u.username AS channel_name,

        (
          SELECT COUNT(*)
          FROM likes
          WHERE likes.video_id = v.id
        ) AS likes_count,

        (
          SELECT COUNT(*)
          FROM comments
          WHERE comments.video_id = v.id
        ) AS comments_count

      FROM videos v

      INNER JOIN users u
        ON u.id = v.user_id

      ORDER BY v.created_at DESC
    `);

    res.json({
      videos: videos.map((video) => ({
        ...video,

        filename:
          getSafePublicPath(
            video.filename
          ),

        thumbnail:
          video.thumbnail ||
          '/images/default-thumb.jpg',

        likes_count:
          Number(video.likes_count || 0),

        comments_count:
          Number(video.comments_count || 0)
      }))
    });
  } catch (error) {
    console.error(
      'Hata /api/videos:',
      error
    );

    res.status(500).json({
      error:
        'Video listesi alınamadı.'
    });
  }
});

/* =========================================================
   SINGLE VIDEO
========================================================= */

app.get('/api/videos/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);

    const video = await dbGet(
      `
      SELECT
        v.*,
        u.username AS channel_name
      FROM videos v
      INNER JOIN users u
        ON u.id = v.user_id
      WHERE v.id = ?
      `,
      [id]
    );

    if (!video) {
      return res.status(404).json({
        error:
          'Video bulunamadı.'
      });
    }

    const comments = await dbAll(
      `
      SELECT
        c.*,
        u.username
      FROM comments c
      INNER JOIN users u
        ON u.id = c.user_id
      WHERE c.video_id = ?
      ORDER BY c.created_at DESC
      `,
      [id]
    );

    const likesCount = await dbGet(
      `
      SELECT COUNT(*) AS count
      FROM likes
      WHERE video_id = ?
      `,
      [id]
    );

    const subscribersCount =
      await dbGet(
        `
        SELECT COUNT(*) AS count
        FROM subscriptions
        WHERE channel_id = ?
        `,
        [video.user_id]
      );

    const currentUserId =
      req.session.userId || null;

    const likeExists = currentUserId
      ? await dbGet(
          `
          SELECT id
          FROM likes
          WHERE
            video_id = ?
            AND user_id = ?
          `,
          [id, currentUserId]
        )
      : null;

    const subscriptionExists =
      currentUserId
        ? await dbGet(
            `
            SELECT id
            FROM subscriptions
            WHERE
              subscriber_id = ?
              AND channel_id = ?
            `,
            [
              currentUserId,
              video.user_id
            ]
          )
        : null;

    res.json({
      video: {
        ...video,

        filename:
          getSafePublicPath(
            video.filename
          ),

        thumbnail:
          video.thumbnail ||
          '/images/default-thumb.jpg',

        likes_count:
          Number(
            likesCount?.count || 0
          ),

        subscribers_count:
          Number(
            subscribersCount?.count || 0
          ),

        liked:
          Boolean(likeExists),

        subscribed:
          Boolean(subscriptionExists),

        is_owner:
          Number(currentUserId) ===
          Number(video.user_id),

        comments:
          comments.map((comment) => ({
            ...comment,

            comment:
              escapeHtml(
                comment.comment
              ),

            username:
              escapeHtml(
                comment.username
              )
          }))
      }
    });
  } catch (error) {
    console.error(
      'Hata /api/videos/:id:',
      error
    );

    res.status(500).json({
      error:
        'Video bilgisi alınamadı.'
    });
  }
});

/* =========================================================
   SEARCH
========================================================= */

app.get('/api/search', async (req, res) => {
  try {
    const query =
      sanitizeText(
        req.query.q || ''
      ).toLowerCase();

    if (!query) {
      return res.json({
        videos: []
      });
    }

    const videos = await dbAll(
      `
      SELECT
        v.*,
        u.username AS channel_name,

        (
          SELECT COUNT(*)
          FROM likes
          WHERE likes.video_id = v.id
        ) AS likes_count,

        (
          SELECT COUNT(*)
          FROM comments
          WHERE comments.video_id = v.id
        ) AS comments_count

      FROM videos v

      INNER JOIN users u
        ON u.id = v.user_id

      WHERE
        LOWER(v.title) LIKE ?
        OR LOWER(v.description) LIKE ?

      ORDER BY v.created_at DESC
      `,
      [
        `%${query}%`,
        `%${query}%`
      ]
    );

    res.json({
      videos: videos.map((video) => ({
        ...video,

        filename:
          getSafePublicPath(
            video.filename
          ),

        thumbnail:
          video.thumbnail ||
          '/images/default-thumb.jpg',

        likes_count:
          Number(
            video.likes_count || 0
          ),

        comments_count:
          Number(
            video.comments_count || 0
          )
      }))
    });
  } catch (error) {
    console.error(
      'Hata /api/search:',
      error
    );

    res.status(500).json({
      error:
        'Arama sırasında hata oluştu.'
    });
  }
});

/* =========================================================
   PROFILE
========================================================= */

app.get(
  '/api/profile/:userId',
  async (req, res) => {
    try {
      const userId =
        Number(req.params.userId);

      const user = await dbGet(
        `
        SELECT
          id,
          username,
          email,
          created_at
        FROM users
        WHERE id = ?
        `,
        [userId]
      );

      if (!user) {
        return res.status(404).json({
          error:
            'Kullanıcı bulunamadı.'
        });
      }

      const videos =
        await dbAll(
          `
          SELECT
            v.*,

            (
              SELECT COUNT(*)
              FROM likes
              WHERE likes.video_id = v.id
            ) AS likes_count

          FROM videos v
          WHERE v.user_id = ?
          ORDER BY v.created_at DESC
          `,
          [userId]
        );

      const subscriberCount =
        await dbGet(
          `
          SELECT COUNT(*) AS count
          FROM subscriptions
          WHERE channel_id = ?
          `,
          [userId]
        );

      res.json({
        user: {
          ...user,

          subscribers_count:
            Number(
              subscriberCount?.count ||
              0
            ),

          videos_count:
            videos.length
        },

        videos: videos.map(
          (video) => ({
            ...video,

            filename:
              getSafePublicPath(
                video.filename
              ),

            thumbnail:
              video.thumbnail ||
              '/images/default-thumb.jpg',

            likes_count:
              Number(
                video.likes_count ||
                0
              )
          })
        )
      });
    } catch (error) {
      console.error(
        'Hata /api/profile:',
        error
      );

      res.status(500).json({
        error:
          'Profil verisi alınamadı.'
      });
    }
  }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
  '/api/register',
  async (req, res) => {
    try {
      const username =
        sanitizeText(
          req.body.username || ''
        ).slice(0, 40);

      const email =
        sanitizeText(
          req.body.email || ''
        ).toLowerCase();

      const password =
        String(
          req.body.password || ''
        );

      if (
        !username ||
        !email ||
        !password
      ) {
        return res.status(400).json({
          error:
            'Kullanıcı adı, e-posta ve şifre zorunludur.'
        });
      }

      if (password.length < 6) {
        return res.status(400).json({
          error:
            'Şifre en az 6 karakter olmalıdır.'
        });
      }

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
          email
        )
      ) {
        return res.status(400).json({
          error:
            'Geçerli bir e-posta adresi girin.'
        });
      }

      const existingUser =
        await dbGet(
          `
          SELECT id
          FROM users
          WHERE username = ?
             OR email = ?
          `,
          [username, email]
        );

      if (existingUser) {
        return res.status(409).json({
          error:
            'Bu kullanıcı adı veya e-posta zaten kullanımda.'
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          10
        );

      const insertResult =
        await dbRun(
          `
          INSERT INTO users
          (
            username,
            email,
            password_hash,
            created_at
          )
          VALUES (?, ?, ?, ?)
          `,
          [
            username,
            email,
            passwordHash,
            new Date().toISOString()
          ]
        );

      req.session.userId =
        insertResult.id;

      req.session.username =
        username;

      req.session.email =
        email;

      req.session.save((err) => {
        if (err) {
          console.error(
            'Session kaydetme hatası:',
            err
          );

          return res.status(500).json({
            error:
              'Oturum oluşturulamadı.'
          });
        }

        res.status(201).json({
          success: true,

          user: {
            id:
              insertResult.id,
            username,
            email
          }
        });
      });
    } catch (error) {
      console.error(
        'Kayıt sırasında hata:',
        error
      );

      res.status(500).json({
        error:
          'Kayıt esnasında hata oluştu.'
      });
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  '/api/login',
  async (req, res) => {
    try {
      const email =
        sanitizeText(
          req.body.email || ''
        ).toLowerCase();

      const password =
        String(
          req.body.password || ''
        );

      if (
        !email ||
        !password
      ) {
        return res.status(400).json({
          error:
            'E-posta ve şifre gerekli.'
        });
      }

      const user =
        await dbGet(
          `
          SELECT *
          FROM users
          WHERE email = ?
          `,
          [email]
        );

      if (!user) {
        return res.status(401).json({
          error:
            'Kullanıcı bulunamadı.'
        });
      }

      const isValid =
        await bcrypt.compare(
          password,
          user.password_hash
        );

      if (!isValid) {
        return res.status(401).json({
          error:
            'Şifre yanlış.'
        });
      }

      req.session.userId =
        user.id;

      req.session.username =
        user.username;

      req.session.email =
        user.email;

      req.session.save((err) => {
        if (err) {
          console.error(
            'Session kaydetme hatası:',
            err
          );

          return res.status(500).json({
            error:
              'Oturum kaydedilemedi.'
          });
        }

        res.json({
          success: true,

          user: {
            id: user.id,
            username:
              user.username,
            email:
              user.email
          }
        });
      });
    } catch (error) {
      console.error(
        'Giriş sırasında hata:',
        error
      );

      res.status(500).json({
        error:
          'Giriş işlemi başarısız oldu.'
      });
    }
  }
);

/* =========================================================
   LOGOUT
========================================================= */

app.post(
  '/api/logout',
  (req, res) => {
    req.session.destroy((err) => {
      if (err) {
        return res.status(500).json({
          error:
            'Oturum kapatılamadı.'
        });
      }

      res.clearCookie(
        'connect.sid'
      );

      res.json({
        success: true,
        message:
          'Çıkış yapıldı.'
      });
    });
  }
);

/* =========================================================
   VIDEO UPLOAD
========================================================= */

app.post(
  '/api/upload',
  requireAuth,
  (req, res) => {
    const uploadFields =
      uploadMiddleware.fields([
        {
          name: 'video',
          maxCount: 1
        },
        {
          name: 'thumbnail',
          maxCount: 1
        }
      ]);

    uploadFields(
      req,
      res,
      async (err) => {
        if (err) {
          console.error(
            'Multer upload hatası:',
            err
          );

          return res.status(400).json({
            error:
              err.message ||
              'Dosya yükleme hatası.'
          });
        }

        try {
          const videoFile =
            req.files?.video?.[0] ||
            null;

          const thumbnailFile =
            req.files?.thumbnail?.[0] ||
            null;

          if (
            !videoFile ||
            !thumbnailFile
          ) {
            return res.status(400).json({
              error:
                'Video ve thumbnail dosyaları zorunludur.'
            });
          }

          const title =
            sanitizeText(
              req.body.title || ''
            ).slice(0, 120);

          const description =
            sanitizeText(
              req.body.description ||
              ''
            ).slice(0, 2000);

          const category =
            sanitizeText(
              req.body.category ||
              'Genel'
            ).slice(0, 50);

          if (!title) {
            return res.status(400).json({
              error:
                'Video başlığı gereklidir.'
            });
          }

          const relativeVideoPath =
            `uploads/videos/${videoFile.filename}`;

          const relativeThumbPath =
            `uploads/thumbnails/${thumbnailFile.filename}`;

          const insertResult =
            await dbRun(
              `
              INSERT INTO videos
              (
                user_id,
                title,
                description,
                filename,
                thumbnail,
                category,
                views,
                created_at
              )
              VALUES (?, ?, ?, ?, ?, ?, 0, ?)
              `,
              [
                req.session.userId,
                title,
                description,
                relativeVideoPath,
                relativeThumbPath,
                category,
                new Date().toISOString()
              ]
            );

          res.status(201).json({
            success: true,

            message:
              'Video yüklendi.',

            video: {
              id:
                insertResult.id,

              title,

              description,

              filename:
                getSafePublicPath(
                  relativeVideoPath
                ),

              thumbnail:
                getSafePublicPath(
                  relativeThumbPath
                ),

              category
            }
          });
        } catch (uploadError) {
          console.error(
            'Upload işlemi sırasında hata:',
            uploadError
          );

          try {
            if (
              req.files?.video?.[0]
            ) {
              fs.unlinkSync(
                req.files
                  .video[0]
                  .path
              );
            }

            if (
              req.files?.thumbnail?.[0]
            ) {
              fs.unlinkSync(
                req.files
                  .thumbnail[0]
                  .path
              );
            }
          } catch (cleanupError) {
            console.error(
              'Dosya temizleme hatası:',
              cleanupError
            );
          }

          res.status(500).json({
            error:
              'Video yüklenirken hata oluştu.'
          });
        }
      }
    );
  }
);

/* =========================================================
   VIEW
========================================================= */

app.post(
  '/api/videos/:id/view',
  async (req, res) => {
    try {
      const videoId =
        Number(req.params.id);

      const cooldownMs =
        60 * 1000;

      if (
        !req.session.viewedVideos
      ) {
        req.session.viewedVideos = {};
      }

      const lastView =
        Number(
          req.session.viewedVideos[
            videoId
          ] || 0
        );

      const now = Date.now();

      if (
        !lastView ||
        now - lastView >
          cooldownMs
      ) {
        await dbRun(
          `
          UPDATE videos
          SET views = views + 1
          WHERE id = ?
          `,
          [videoId]
        );

        req.session.viewedVideos[
          videoId
        ] = now;

        req.session.save(() => {});
      }

      const video =
        await dbGet(
          `
          SELECT views
          FROM videos
          WHERE id = ?
          `,
          [videoId]
        );

      res.json({
        success: true,

        views:
          Number(
            video?.views || 0
          )
      });
    } catch (error) {
      console.error(
        'İzlenme güncelleme hatası:',
        error
      );

      res.status(500).json({
        error:
          'İzlenme kaydedilemedi.'
      });
    }
  }
);

/* =========================================================
   LIKE
========================================================= */

app.post(
  '/api/videos/:id/like',
  requireAuth,
  async (req, res) => {
    try {
      const videoId =
        Number(req.params.id);

      const existing =
        await dbGet(
          `
          SELECT id
          FROM likes
          WHERE
            video_id = ?
            AND user_id = ?
          `,
          [
            videoId,
            req.session.userId
          ]
        );

      if (existing) {
        return res.status(409).json({
          error:
            'Bu video zaten beğenilmiş.'
        });
      }

      await dbRun(
        `
        INSERT INTO likes
        (
          video_id,
          user_id,
          created_at
        )
        VALUES (?, ?, ?)
        `,
        [
          videoId,
          req.session.userId,
          new Date().toISOString()
        ]
      );

      const likesCount =
        await dbGet(
          `
          SELECT COUNT(*) AS count
          FROM likes
          WHERE video_id = ?
          `,
          [videoId]
        );

      res.status(201).json({
        success: true,

        likes_count:
          Number(
            likesCount?.count || 0
          ),

        liked: true
      });
    } catch (error) {
      console.error(
        'Beğeni hatası:',
        error
      );

      res.status(500).json({
        error:
          'Beğeni eklenemedi.'
      });
    }
  }
);

app.delete(
  '/api/videos/:id/like',
  requireAuth,
  async (req, res) => {
    try {
      const videoId =
        Number(req.params.id);

      await dbRun(
        `
        DELETE FROM likes
        WHERE
          video_id = ?
          AND user_id = ?
        `,
        [
          videoId,
          req.session.userId
        ]
      );

      const likesCount =
        await dbGet(
          `
          SELECT COUNT(*) AS count
          FROM likes
          WHERE video_id = ?
          `,
          [videoId]
        );

      res.json({
        success: true,

        likes_count:
          Number(
            likesCount?.count || 0
          ),

        liked: false
      });
    } catch (error) {
      console.error(
        'Beğeni kaldırma hatası:',
        error
      );

      res.status(500).json({
        error:
          'Beğeni kaldırılamadı.'
      });
    }
  }
);

/* =========================================================
   COMMENT + MODERATION
========================================================= */

app.post(
  '/api/videos/:id/comment',
  requireAuth,
  async (req, res) => {
    try {
      const videoId =
        Number(req.params.id);

      const userId =
        Number(req.session.userId);

      const rawComment =
        sanitizeText(
          req.body.comment || ''
        );

      if (
        !rawComment ||
        rawComment.length < 2
      ) {
        return res.status(400).json({
          error:
            'Yorum en az 2 karakter olmalıdır.'
        });
      }

      /* -----------------------------------------
         Moderasyon kaydı
      ----------------------------------------- */

      let moderation =
        await dbGet(
          `
          SELECT *
          FROM moderation
          WHERE user_id = ?
          `,
          [userId]
        );

      if (!moderation) {
        await dbRun(
          `
          INSERT INTO moderation
          (
            user_id,
            strikes,
            blocked_until
          )
          VALUES (?, 0, 0)
          `,
          [userId]
        );

        moderation = {
          user_id: userId,
          strikes: 0,
          blocked_until: 0
        };
      }

      /* -----------------------------------------
         Geçici engel kontrolü
      ----------------------------------------- */

      const now = Date.now();
      const blockedUntil =
        Number(
          moderation.blocked_until || 0
        );

      if (blockedUntil > now) {
        const remainingMinutes =
          Math.ceil(
            (blockedUntil - now) /
            60000
          );

        return res.status(429).json({
          error:
            `Yorum yazmanız geçici olarak engellendi. ` +
            `Kalan süre yaklaşık ${remainingMinutes} dakika.`
        });
      }

      /* -----------------------------------------
         Aynı yorumu kısa sürede tekrar gönderme
      ----------------------------------------- */

      const recentComment =
        await dbGet(
          `
          SELECT
            id,
            comment,
            created_at
          FROM comments
          WHERE user_id = ?
          ORDER BY id DESC
          LIMIT 1
          `,
          [userId]
        );

      let repeatedSpam = false;

      if (recentComment) {
        const lastTime =
          new Date(
            recentComment.created_at
          ).getTime();

        const secondsSinceLastComment =
          (Date.now() - lastTime) /
          1000;

        const currentNormalized =
          normalizeModerationText(
            rawComment
          );

        const previousNormalized =
          normalizeModerationText(
            recentComment.comment
          );

        if (
          secondsSinceLastComment < 15 &&
          currentNormalized ===
            previousNormalized
        ) {
          repeatedSpam = true;
        }
      }

      /* -----------------------------------------
         Küfür / spam tespiti
      ----------------------------------------- */

      const contentViolation =
        detectModerationViolation(
          rawComment
        );

      const violation =
        contentViolation ||
        (
          repeatedSpam
            ? {
                type: 'spam',
                reason:
                  'Aynı yorum kısa süre içinde tekrar gönderildi.'
              }
            : null
        );

      /* -----------------------------------------
         İhlal varsa
      ----------------------------------------- */

      if (violation) {
        const currentStrikes =
          Number(
            moderation.strikes || 0
          );

        const newStrikes =
          currentStrikes + 1;

        let newBlockedUntil = 0;
        let warningMessage = '';

        if (newStrikes === 1) {
          warningMessage =
            `⚠️ İlk uyarı: ${violation.reason} ` +
            `Yorumunuz yayınlanmadı. ` +
            `Tekrarında geçici yorum engeli uygulanabilir.`;
        } else if (newStrikes === 2) {
          newBlockedUntil =
            Date.now() +
            10 * 60 * 1000;

          warningMessage =
            `🚫 İkinci uyarı: ${violation.reason} ` +
            `Yorum yazma özelliğiniz 10 dakika engellendi.`;
        } else {
          newBlockedUntil =
            Date.now() +
            60 * 60 * 1000;

          warningMessage =
            `🚫 Tekrarlanan ihlal: ${violation.reason} ` +
            `Yorum yazma özelliğiniz 1 saat engellendi.`;
        }

        await dbRun(
          `
          UPDATE moderation
          SET
            strikes = ?,
            blocked_until = ?,
            last_flagged_at = ?
          WHERE user_id = ?
          `,
          [
            newStrikes,
            newBlockedUntil,
            new Date().toISOString(),
            userId
          ]
        );

        console.log(
          `[MODERATION] user=${userId} ` +
          `type=${violation.type} ` +
          `strike=${newStrikes}`
        );

        return res.status(422).json({
          error: warningMessage,

          moderation: {
            warning: true,
            strike: newStrikes,
            type: violation.type
          }
        });
      }

      /* -----------------------------------------
         Temiz yorum
      ----------------------------------------- */

      const commentText =
        escapeHtml(
          rawComment
        );

      const insertResult =
        await dbRun(
          `
          INSERT INTO comments
          (
            video_id,
            user_id,
            comment,
            created_at
          )
          VALUES (?, ?, ?, ?)
          `,
          [
            videoId,
            userId,
            commentText,
            new Date().toISOString()
          ]
        );

      const comment =
        await dbGet(
          `
          SELECT
            c.*,
            u.username
          FROM comments c
          INNER JOIN users u
            ON u.id = c.user_id
          WHERE c.id = ?
          `,
          [insertResult.id]
        );

      res.status(201).json({
        success: true,

        comment: {
          ...comment,
          comment:
            comment.comment,
          username:
            comment.username,
          created_at:
            comment.created_at
        }
      });
    } catch (error) {
      console.error(
        'Yorum/moderasyon hatası:',
        error
      );

      res.status(500).json({
        error:
          'Yorum işlenirken hata oluştu.'
      });
    }
  }
);

/* =========================================================
   COMMENT DELETE
========================================================= */

app.delete(
  '/api/comments/:id',
  requireAuth,
  async (req, res) => {
    try {
      const commentId =
        Number(req.params.id);

      const comment =
        await dbGet(
          `
          SELECT user_id
          FROM comments
          WHERE id = ?
          `,
          [commentId]
        );

      if (!comment) {
        return res.status(404).json({
          error:
            'Yorum bulunamadı.'
        });
      }

      if (
        Number(comment.user_id) !==
        Number(req.session.userId)
      ) {
        return res.status(403).json({
          error:
            'Bu yorumu silmeye yetkiniz yok.'
        });
      }

      await dbRun(
        `
        DELETE FROM comments
        WHERE id = ?
        `,
        [commentId]
      );

      res.json({
        success: true,
        message:
          'Yorum silindi.'
      });
    } catch (error) {
      console.error(
        'Yorum silme hatası:',
        error
      );

      res.status(500).json({
        error:
          'Yorum silinemedi.'
      });
    }
  }
);

/* =========================================================
   SUBSCRIBE
========================================================= */

app.post(
  '/api/users/:id/subscribe',
  requireAuth,
  async (req, res) => {
    try {
      const channelId =
        Number(req.params.id);

      if (
        channelId ===
        Number(req.session.userId)
      ) {
        return res.status(400).json({
          error:
            'Kendi kanalınıza abone olamazsınız.'
        });
      }

      const existing =
        await dbGet(
          `
          SELECT id
          FROM subscriptions
          WHERE
            subscriber_id = ?
            AND channel_id = ?
          `,
          [
            req.session.userId,
            channelId
          ]
        );

      if (existing) {
        return res.status(409).json({
          error:
            'Zaten abonesiniz.'
        });
      }

      await dbRun(
        `
        INSERT INTO subscriptions
        (
          subscriber_id,
          channel_id,
          created_at
        )
        VALUES (?, ?, ?)
        `,
        [
          req.session.userId,
          channelId,
          new Date().toISOString()
        ]
      );

      const subscribersCount =
        await dbGet(
          `
          SELECT COUNT(*) AS count
          FROM subscriptions
          WHERE channel_id = ?
          `,
          [channelId]
        );

      res.status(201).json({
        success: true,
        subscribed: true,

        subscribers_count:
          Number(
            subscribersCount?.count ||
            0
          )
      });
    } catch (error) {
      console.error(
        'Abonelik hatası:',
        error
      );

      res.status(500).json({
        error:
          'Abonelik işlemi başarısız oldu.'
      });
    }
  }
);

app.delete(
  '/api/users/:id/subscribe',
  requireAuth,
  async (req, res) => {
    try {
      const channelId =
        Number(req.params.id);

      await dbRun(
        `
        DELETE FROM subscriptions
        WHERE
          subscriber_id = ?
          AND channel_id = ?
        `,
        [
          req.session.userId,
          channelId
        ]
      );

      const subscribersCount =
        await dbGet(
          `
          SELECT COUNT(*) AS count
          FROM subscriptions
          WHERE channel_id = ?
          `,
          [channelId]
        );

      res.json({
        success: true,
        subscribed: false,

        subscribers_count:
          Number(
            subscribersCount?.count ||
            0
          )
      });
    } catch (error) {
      console.error(
        'Abonelik kaldırma hatası:',
        error
      );

      res.status(500).json({
        error:
          'Abonelik kaldırma işlemi başarısız oldu.'
      });
    }
  }
);

/* =========================================================
   USER / CHANNEL
========================================================= */

app.get(
  '/api/users/:id',
  async (req, res) => {
    try {
      const userId =
        Number(req.params.id);

      const user =
        await dbGet(
          `
          SELECT
            id,
            username,
            created_at
          FROM users
          WHERE id = ?
          `,
          [userId]
        );

      if (!user) {
        return res.status(404).json({
          error:
            'Kullanıcı bulunamadı.'
        });
      }

      const videos =
        await dbAll(
          `
          SELECT
            id,
            title,
            filename,
            thumbnail,
            category,
            views,
            created_at
          FROM videos
          WHERE user_id = ?
          ORDER BY created_at DESC
          `,
          [userId]
        );

      const subscribersCount =
        await dbGet(
          `
          SELECT COUNT(*) AS count
          FROM subscriptions
          WHERE channel_id = ?
          `,
          [userId]
        );

      res.json({
        user: {
          ...user,

          subscribers_count:
            Number(
              subscribersCount?.count ||
              0
            ),

          videos_count:
            videos.length
        },

        videos:
          videos.map((video) => ({
            ...video,

            filename:
              getSafePublicPath(
                video.filename
              ),

            thumbnail:
              video.thumbnail ||
              '/images/default-thumb.jpg'
          }))
      });
    } catch (error) {
      console.error(
        'Kanal bilgisi hatası:',
        error
      );

      res.status(500).json({
        error:
          'Kanal bilgisi alınamadı.'
      });
    }
  }
);

/* =========================================================
   ANA SAYFA
========================================================= */

app.get('/', (req, res) => {
  res.sendFile(
    path.join(
      PUBLIC_DIR,
      'index.html'
    )
  );
});

/* =========================================================
   SAYFALAR
========================================================= */

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    return next();
  }

  const cleanPath =
    req.path
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');

  const filePath =
    path.join(
      PUBLIC_DIR,
      cleanPath || 'index.html'
    );

  if (
    fs.existsSync(filePath) &&
    fs.statSync(filePath).isFile()
  ) {
    return res.sendFile(filePath);
  }

  const notFound =
    path.join(
      PUBLIC_DIR,
      '404.html'
    );

  if (fs.existsSync(notFound)) {
    return res
      .status(404)
      .sendFile(notFound);
  }

  res.status(404).send(
    'Sayfa bulunamadı.'
  );
});

/* =========================================================
   ERROR HANDLER
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      '500 hatası:',
      err
    );

    res.status(500).json({
      error:
        'Sunucu hatası oluştu. Lütfen tekrar deneyin.'
    });
  }
);

/* =========================================================
   SERVER START
========================================================= */

(async () => {
  try {
    await initializeDatabase();

    app.listen(
      PORT,
      '0.0.0.0',
      () => {
        console.log(
          `Vexo çalışıyor: http://localhost:${PORT}`
        );
      }
    );
  } catch (error) {
    console.error(
      'Sunucu başlatılamadı:',
      error
    );

    process.exit(1);
  }
})();

/* =========================================================
   SHUTDOWN
========================================================= */

process.on('SIGINT', () => {
  db.close((err) => {
    if (err) {
      console.error(
        'Database kapatma hatası:',
        err
      );
    }

    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  db.close((err) => {
    if (err) {
      console.error(
        'Database kapatma hatası:',
        err
      );
    }

    process.exit(0);
  });
});