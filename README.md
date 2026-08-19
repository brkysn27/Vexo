# Vexo

Vexo, YouTube benzeri ama özgün ve bağımsız bir video paylaşım platformu MVP'sidir. Modern, koyu tonlu ve mobil uyumlu bir arayüz ile yerel bilgisayarda çalışacak şekilde tasarlanmıştır.

## Teknolojiler

- Node.js
- Express
- SQLite
- Multer
- bcrypt
- express-session
- HTML5 Video API
- Vanilla JavaScript
- HTML / CSS

## Proje yapısı

```text
vexo/
├── server.js
├── package.json
├── database.db
├── README.md
├── public/
│   ├── index.html
│   ├── watch.html
│   ├── upload.html
│   ├── login.html
│   ├── register.html
│   ├── profile.html
│   ├── search.html
│   ├── 404.html
│   ├── style.css
│   └── app.js
├── uploads/
│   ├── videos/
│   └── thumbnails/
├── data/
└── .gitignore
```

## Kurulum

```bash
npm install
```

## Veritabanı

Proje ilk çalıştırıldığında `database.db` dosyası otomatik olarak oluşturulur. Aşağıdaki tablolar oluşturulur:

- users
- videos
- comments
- likes
- subscriptions

## Sunucuyu çalıştırma

```bash
npm start
```

Geliştirme modu için:

```bash
npm run dev
```

## Uygulama adresi

Yerel geliştirme için tarayıcıdan şu adrese erişebilirsiniz:

```text
http://localhost:3000
```

## Render / deployment notları

- `server.js` `process.env.PORT` değerini kullanır; hosting ortamı verdiği portu dinlemelidir.
- Sunucu `0.0.0.0` üzerinde dinlemelidir; bu, Render gibi dışarıdan erişilebilir ortamlarda gereklidir.
- Frontend API çağrıları göreli URL'ler kullanır (`/api/...`); localhost sabit adresi kullanılmaz.
- `uploads/videos/` ve `uploads/thumbnails/` klasörleri, Render gibi ephemeral ortamlarında kalıcı olmayabilir. Kalıcı dosya depolaması gerekiyorsa disk eklemeyi veya bulut depolama kullanmayı düşünün.
- SQLite veritabanı `database.db` dosyası, üretim ortamında kalıcı bir depolama alanı gerektirir. Render gibi geçici dosya sistemlerinde veriler kaybolabilir; kalıcı disk veya ayrı veritabanı servisi kullanılması önerilir.

## Video yükleme

Video yükleme için giriş yapmış olmanız gerekir. Desteklenen uzantılar şunlardır:

- .mp4
- .webm
- .mov
- .mkv
- .ogg

Maksimum video boyutu: 100 MB
Maksimum thumbnail boyutu: 5 MB

## Yerel ağdan tablet erişimi

Aynı ağda bulunan bir tablette erişmek için bilgisayarınızın IP adresini kullanın:

```bash
ipconfig
```

Daha sonra:

```text
http://<BİLGİSAYAR_IP>:3000
```

## Bilinen sınırlamalar

- Proje yerel çalışma için tasarlanmıştır; canlı sunucu ayarı için ek güvenlik ve üretim optimizasyonları gerekir.
- Video dosyaları yerel depolamada tutulur; büyük ölçekli dağıtım için CDN ve bulut depolama daha uygun olur.
- SQLite kullanımı üretimde kalıcı depolama gerektirir; depolama alanı yoksa veriler resetlenebilir.
- HTML5 video oynatıcısı yerel tarayıcı desteğine bağlıdır.

## Özellikler

- Kullanıcı kayıt ve giriş
- Şifreler bcrypt ile hashlenir
- Session tabanlı kimlik doğrulama
- Video yükleme ve çalışma alanı
- İzlenme, beğeni ve yorum sistemi
- Abonelik sistemi
- Arama ekranı
- Profil sayfası
- Responsive masaüstü/tablet/mobil tasarım
- Özel 404 sayfası
