<div align="center">

# 🎵 Spotify Şeffaf Overlay

**Çalan şarkı, her zaman gözünün önünde.**

Masaüstünde şeffaf, hep-üstte bir "now playing" kartı — oynatma kontrolleri, ses boost & EQ dahil.
Hesap yok, giriş yok, kurulum derdi yok.

[![Windows 10/11](https://img.shields.io/badge/Windows-10%20%2F%2011-0078D4?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/DarkCreative1/SpotifyWidget/releases)
[![Electron](https://img.shields.io/badge/Electron-42-47848F?style=for-the-badge&logo=electron&logoColor=white)](https://www.electronjs.org/)
[![License: GPL-3.0](https://img.shields.io/badge/Lisans-GPL--3.0-green?style=for-the-badge)](LICENSE)
[![GitHub Stars](https://img.shields.io/github/stars/DarkCreative1/SpotifyWidget?style=for-the-badge&color=yellow&logo=github)](https://github.com/DarkCreative1/SpotifyWidget)

<br />

<img src="assets/promo.png" alt="Spotify Şeffaf Overlay — Masaüstü Önizleme" width="720" />

</div>

<br />

## ✨ Özellikler

| Özellik | Açıklama |
|---|---|
| 🪟 **Şeffaf Overlay** | Hep-üstte, sürüklenebilir kart — istediğin yere taşı |
| ▶️ **Oynatma Kontrolleri** | Oynat · Duraklat · İleri · Geri · Karıştır · Tekrarla |
| 🔊 **Ses Kontrolü** | Spotify ses seviyesini doğrudan overlay üzerinden ayarla |
| 🎨 **Dinamik Tema** | Albüm kapağından otomatik renk çıkarma & arka plan parıltısı |
| 🎛️ **Ses Boost & EQ** | Equalizer APO entegrasyonu ile güçlendirilmiş ses deneyimi |
| ⚙️ **Ayarlar Paneli** | Boyut, opaklık, tema rengi, visualizer ve başlangıç davranışını özelleştir |
| ⌨️ **Kısayol Tuşları** | Medya kontrolleri için global klavye kısayolları |
| 📌 **Akıllı Konumlandırma** | Ekran kenarlarına yapışma & çoklu monitör desteği |

<br />

## 🚀 Kurulum

### Hazır Çalıştırılabilir (Önerilen)

[**📥 Releases**](https://github.com/DarkCreative1/SpotifyWidget/releases) sayfasından en son sürümü indir ve çalıştır — başka bir şeye gerek yok.

### Kaynak Koddan Derleme

```bash
# 1. Repoyu klonla
git clone https://github.com/DarkCreative1/SpotifyWidget.git
cd SpotifyWidget

# 2. Bağımlılıkları yükle
npm install

# 3. Geliştirme modunda çalıştır
npm run dev

# 4. Portable .exe oluştur
npm run build
```

<br />

## 📋 Gereksinimler

| Gereksinim | Detay |
|---|---|
| **İşletim Sistemi** | Windows 10 / 11 |
| **Node.js** | v18 veya üzeri (sadece kaynak koddan derleme için) |
| **Spotify** | Masaüstü uygulaması yüklü ve çalışır durumda |
| **Equalizer APO** | *(İsteğe bağlı)* Ses boost & EQ özellikleri için |

<br />

## ⚙️ Yapılandırma

System tray ikonuna **sağ tık** yaparak ayarlar panelini aç. Buradan özelleştirebileceğin seçenekler:

- 🎚️ **Overlay boyutu** — ölçek faktörü (0.7× – 1.8×)
- 🎨 **Tema & opaklık** — renk paleti ve şeffaflık seviyesi
- 🔈 **Ses boost** — Equalizer APO ile ses güçlendirme
- 🚀 **Başlangıçta çalıştır** — Windows ile birlikte otomatik başlat

<br />

## 🏗️ Proje Yapısı

```
spotify-transparent-overlay/
├── assets/                  # İkonlar & tanıtım görselleri
│   ├── icon.png
│   ├── tray.png
│   └── promo.png
├── src/
│   ├── main/                # Electron ana süreç
│   │   ├── main.js          # Uygulama giriş noktası & pencere yönetimi
│   │   ├── nowPlaying.js    # SMTC ile çalan şarkı bilgisi
│   │   ├── mediaControl.js  # Medya kontrol komutları
│   │   ├── volumeControl.js # Ses seviyesi yönetimi
│   │   ├── apoController.js # Equalizer APO entegrasyonu
│   │   └── store.js         # Kalıcı ayar deposu
│   ├── preload/             # Electron preload scriptleri
│   └── renderer/            # Kullanıcı arayüzü
│       ├── overlay.html     # Ana overlay kartı
│       ├── overlay.css
│       ├── overlay.js
│       ├── settings.html    # Ayarlar penceresi
│       ├── settings.css
│       └── settings.js
├── package.json
├── LICENSE                  # GPL-3.0
└── README.md
```

<br />

## 🛠️ Kullanılan Teknolojiler

<div align="center">

![Electron](https://img.shields.io/badge/Electron-47848F?style=flat-square&logo=electron&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![PowerShell](https://img.shields.io/badge/PowerShell-5391FE?style=flat-square&logo=powershell&logoColor=white)

</div>

- **Electron** — Çapraz platform masaüstü uygulama çatısı
- **Windows SMTC** — Sistem medya bilgilerini okuma (`@coooookies/windows-smtc-monitor`)
- **PowerShell** — Sistem seviyesinde medya ve ses kontrolü
- **Equalizer APO** — Gelişmiş ses işleme & boost

<br />

## 🤝 Katkıda Bulunma

Katkılarınız memnuniyetle karşılanır! Bir hata bulduysan veya yeni bir özellik önereceksen:

1. Bu repoyu **fork** et
2. Yeni bir branch oluştur (`git checkout -b ozellik/harika-ozellik`)
3. Değişikliklerini commit et (`git commit -m 'Harika özellik eklendi'`)
4. Branch'i push et (`git push origin ozellik/harika-ozellik`)
5. Bir **Pull Request** aç

<br />

## 📄 Lisans

Bu proje [**GNU General Public License v3.0**](LICENSE) ile lisanslanmıştır. Detaylar için `LICENSE` dosyasına bakın.

<br />

---

<div align="center">

**⭐ Projeyi beğendiysen yıldız vermeyi unutma!**

<sub>Made with ❤️ by <a href="https://github.com/DarkCreative1">dark</a></sub>

</div>
