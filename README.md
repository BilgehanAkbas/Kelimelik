# Kelimelik

**Kelimelik**, Türkçe kelime tahminini tek oyunculu, günlük ve çevrimiçi oyun seçenekleriyle birleştiren web tabanlı bir kelime oyunudur.

## Oyun Modları

### Günlük Bulmaca
- Her gün 5 harfli yeni bir bulmaca açılır.
- 8 tahmin hakkı vardır.
- Yarım bırakılan günlük oyun aynı gün kaldığı yerden devam eder.

### Kelimelik Modu
- 4, 5 ve 6 harf seçenekleri bulunur.
- 8 tahmin hakkı vardır.
- Her tahminde toplam **yeşil / sarı / kırmızı** sayıları gösterilir.
- Gönderilmiş harf kutuları oyuncunun kendi notları için işaretlenebilir.
- Uygun oyunlarda bir kez ipucu kullanılabilir.

### Klasik Mod
- 4 harf: 5 tahmin
- 5 harf: 6 tahmin
- 6 harf: 7 tahmin
- Harfler tahminden sonra doğrudan yeşil / sarı / kırmızı renklendirilir.

### Online Oyun
- Arkadaşla özel oda oluşturma ve oda koduyla katılma
- Hızlı eşleşme
- Efe, Defne ve Atlas bot rakipleri
- Kelimelik ve Klasik modlarında 4 / 5 / 6 harf desteği
- Tamamlanan online ve bot maçlarının geçmiş ve istatistiklere eklenmesi

## Profil ve Oyun Verileri

Profil alanında takma ad, istatistikler, kelime geçmişi, favoriler ve ayarlar bulunur. Tek oyunculu oyun verileri tarayıcıdaki `localStorage` alanında tutulur. Online profil ve maç verileri Supabase üzerinden yönetilir.

## Kelime Havuzu

Tahmin ve cevap havuzları `src/js/word-pools.js` içinde tutulur. Uygulama TDK tabanlı kelime kaynakları ve TDK sözlük anlam servisiyle birlikte çalışır.

## Kod Yapısı

```text
Kelimelik/
├─ index.html
├─ manifest.webmanifest
├─ sw.js
├─ src/
│  ├─ css/
│  │  ├─ style.css
│  │  └─ mobile-fixes.css
│  └─ js/
│     ├─ game-core.js
│     ├─ word-pools.js
│     ├─ online-config.js
│     ├─ online.js
│     ├─ app.js
│     ├─ ui-patches.js
│     └─ mobile-fixes.js
├─ supabase/
│  └─ migrations/
├─ tests/
└─ .github/workflows/
```

### Temel Dosyalar

- `index.html`: Ana sayfa, oyun ekranı, modal kökü ve istemci dosyalarının yükleme sırası.
- `src/js/game-core.js`: Kelime geri bildirimi, seed ve günlük bulmaca gibi saf oyun mantıkları.
- `src/js/word-pools.js`: Tahmin, cevap ve günlük kelime havuzları.
- `src/js/app.js`: Tek oyunculu oyun, arayüz, modal, profil ve yerel kayıt akışları.
- `src/js/online.js`: Supabase bağlantısı, canlı maç, hızlı eşleşme ve bot istemci işlemleri.
- `src/js/ui-patches.js`: Profil, istatistik ve online geçmiş gibi ek arayüz davranışları.
- `src/js/mobile-fixes.js`: Web ve mobil arayüzde son katman davranış düzeltmeleri.
- `src/css/style.css`: Ana tasarım sistemi ve oyun arayüzü.
- `src/css/mobile-fixes.css`: Responsive ve modal/online görünüm düzeltmeleri.
- `sw.js`: PWA önbelleği ve çevrimdışı asset yönetimi.

## Supabase

Online özelliklerin veritabanı ve RPC yapısı `supabase/migrations/` klasöründe tutulur. Supabase Authentication tarafında Anonymous Sign-Ins açık olmalıdır.

`src/js/online-config.js` yalnız tarayıcıda kullanılabilen Supabase Project URL ve publishable/anon key içermelidir. `service_role`, database password, JWT secret veya başka sunucu secret'ları frontend'e yazılmamalıdır.

## Dağıtım ve Güvenlik

Uygulama statik web yapısında çalışır ve Vercel üzerinde yayınlanabilir. Vercel güvenlik başlıkları ve CSP ayarları `vercel.json` ve `index.html` üzerinden yönetilir.

## Test

Ana test paketi:

```bash
node tests/run-tests.js
```

Ek smoke testleri `tests/` klasöründe bulunur ve GitHub Actions tarafından çalıştırılır.

---
Designed & Developed by **Bilgehan Akbaş**
