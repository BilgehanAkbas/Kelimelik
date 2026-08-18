# Kelimelik

**Kelimelik**, Türkçe kelime tahminini günlük, tek oyunculu ve çevrimiçi oyun seçenekleriyle birleştiren web tabanlı bir kelime oyunudur.

## Oyun Bilgileri

### Oyun Modları

- **Günlük Bulmaca:** Her gün yeni bir 5 harfli bulmaca açılır. Oyuncunun 8 tahmin hakkı vardır ve yarım kalan oyun aynı gün kaldığı yerden devam eder.
- **Kelimelik:** 4, 5 veya 6 harf seçilir. Her tahminde harflerin konumu tek tek açıklanmaz; toplam **yeşil / sarı / kırmızı** sayıları gösterilir. Oyun 8 tahminde tamamlanır.
- **Klasik:** 4 harfte 5, 5 harfte 6, 6 harfte 7 tahmin hakkı vardır. Harfler doğrudan yeşil / sarı / kırmızı olarak renklendirilir.
- **Online:** Arkadaşla özel oda, hızlı eşleşme ve Efe / Defne / Atlas bot rakipleri bulunur. Kelimelik ve Klasik modlarında 4 / 5 / 6 harf desteklenir.

### Temel Oynanış

- **Yeşil:** Doğru harf, doğru konum.
- **Sarı:** Doğru harf, yanlış konum.
- **Kırmızı:** Kelimede bulunmayan harf.
- İpucu, uygun oyunlarda en az bir tahminden sonra oyun başına bir kez kullanılabilir.
- Günlük ilerleme, istatistikler, geçmiş, favoriler ve ayarlar tarayıcıda korunur.
- Online profil, maç geçmişi ve multiplayer istatistikleri Supabase üzerinden yönetilir.
- Tamamlanan bulmacalar paylaşılabilir; kelime anlamı ve kelime bildirme seçenekleri sonuç ekranından kullanılabilir.

### Kelime Havuzu

Oyun 4, 5 ve 6 harfli Türkçe tahmin ve cevap havuzları kullanır. Aktif online cevap havuzu A3 sürümüdür ve TDK tabanlı kanonik kelime listesiyle uyumludur. Cevap kelimeleri tahmin havuzunun içinde bulunur; uzunluk ve Türkçe karakter kuralları veritabanı tarafında da doğrulanır.

## Kod Bütünlüğü

Proje, bağımlılığı düşük bir **statik frontend + Supabase backend** yapısında tutulur.

- Oyun kuralları, kelime geri bildirimi ve tek oyunculu akış istemci tarafında çalışır.
- Online maç, hızlı eşleşme, bot mantığı, profil ve multiplayer kayıtları Supabase RPC/migration yapısıyla yönetilir.
- Arayüz masaüstü ve mobil için ortak CSS/JS katmanlarıyla responsive çalışır; PWA ve Service Worker desteği vardır.
- Veritabanı değişiklikleri `supabase/migrations/` altında sıralı migration olarak saklanır. Eski migration'lar yeniden kurulum ve şema geçmişi için korunur.
- Otomatik testler `tests/` altında tutulur ve GitHub Actions ile her push/pull request sırasında çalıştırılır.
- Frontend yalnız Supabase Project URL ve publishable/anon key kullanır. `service_role`, database password, JWT secret veya başka sunucu secret'ları istemci koduna yazılmamalıdır.
- Vercel güvenlik başlıkları ve CSP kuralları deployment yapılandırmasında korunur.

Ana kod alanları özetle `src/js/`, `src/css/`, `supabase/migrations/`, `tests/` ve `.github/workflows/` klasörleridir. Dosya bazında ayrıntı yerine bu katmanların sorumlulukları birbirinden ayrılmıştır.

## Nasıl Çalıştırılır

### Yerelde

Kelimelik statik bir web uygulamasıdır. Repo kökünde basit bir HTTP sunucusu açmak yeterlidir:

```bash
python -m http.server 8080
```

Ardından tarayıcıdan `http://localhost:8080` adresi açılır. Service Worker, module/CORS ve online isteklerinin doğru davranması için projeyi doğrudan `file://` üzerinden açmak yerine bir HTTP sunucusu kullanılması önerilir.

### Supabase

Online özellikler için:

1. Bir Supabase projesi oluşturulur ve **Anonymous Sign-Ins** etkinleştirilir.
2. `supabase/migrations/` içindeki migration'lar sırasıyla uygulanır.
3. `src/js/online-config.js` içine yalnız Supabase Project URL ve publishable/anon key yazılır.
4. `service_role` veya başka gizli sunucu anahtarları frontend'e eklenmez.

### Test

Ana test paketi:

```bash
node tests/run-tests.js
```

Ek smoke testleri `tests/` klasöründe bulunur. GitHub Actions, JavaScript syntax kontrolleriyle birlikte bu testleri otomatik çalıştırır.

### Yayınlama

Repo Vercel'e doğrudan bağlanabilir. Proje statik olduğu için ayrı bir build adımı gerektirmez; repo kökü yayınlanır. PWA önbelleği `sw.js`, güvenlik ve yönlendirme ayarları ise deployment yapılandırması üzerinden yönetilir.

---
Designed & Developed by **Bilgehan Akbaş**
