(()=>{
  "use strict";

  /*
   * Kelimelik arayüz/istatistik yamaları
   * - Klasik istatistiklerde 4/5/6 harf seçimi
   * - Genel istatistiklere online maçları dahil etme
   * - Online istatistik açıklamasını kaldırma
   * - Tüm istatistikleri sıfırlamayı Ayarlar'a taşıma
   * - Profil alt ekranlarında X ile tutarlı geri navigasyon
   * - Özel bulmacada daha anlaşılır gerçek-kelime doğrulaması
   * - Takma ad yardım metnini sadeleştirme
   *
   * app.js'ten SONRA yüklenmelidir.
   */

  const baseDefaultStats = defaultStats;
  const baseLoadStats = loadStats;
  const baseRecordGameResult = recordGameResult;
  const baseStatsPanelHTML = statsPanelHTML;
  const baseNormalizeMultiplayerBucket = normalizeMultiplayerBucket;
  const baseDefaultMultiplayerStats = defaultMultiplayerStats;

  function emptyClassicLengthStats(){
    return {
      "4": emptyStatBucket(),
      "5": emptyStatBucket(),
      "6": emptyStatBucket()
    };
  }

  function normalizeClassicLengthStats(value){
    return {
      "4": normalizeBucket(value?.["4"]),
      "5": normalizeBucket(value?.["5"]),
      "6": normalizeBucket(value?.["6"])
    };
  }

  /*
   * Eski sürümde Klasik istatistikleri tek bir bucket'ta tutuluyordu.
   * Harf bazlı kayıt yoksa geçmişten 4/5/6 olarak bir kez oluşturuyoruz.
   */
  function rebuildClassicLengthStatsFromHistory(){
    const buckets = emptyClassicLengthStats();

    try{
      const entries = [...loadHistory()]
        .filter(item => item?.mode === "classic")
        .reverse();

      entries.forEach(item => {
        const length = Number(item?.length) || String(item?.word || "").length;
        const key = String(length);
        if(!buckets[key]) return;

        updateStatBucket(
          buckets[key],
          Boolean(item?.won),
          item?.won ? (Number(item?.tries) || null) : null
        );
      });
    }catch(error){
      console.warn("Klasik harf istatistikleri geçmişten oluşturulamadı:", error);
    }

    return buckets;
  }

  defaultStats = function(){
    const stats = baseDefaultStats();
    stats.classicModeByLength = emptyClassicLengthStats();
    return stats;
  };

  loadStats = function(){
    const stats = baseLoadStats();
    let stored = null;

    try{
      stored = JSON.parse(localStorage.getItem(STATS_KEY) || "null");
    }catch(error){}

    if(stored?.classicModeByLength){
      stats.classicModeByLength = normalizeClassicLengthStats(
        stored.classicModeByLength
      );
      return stats;
    }

    stats.classicModeByLength = rebuildClassicLengthStatsFromHistory();
    storageSet(STATS_KEY, JSON.stringify(stats));
    return stats;
  };

  function emptyMultiplayerLengthStats(){
    return {
      "4":baseNormalizeMultiplayerBucket({}),
      "5":baseNormalizeMultiplayerBucket({}),
      "6":baseNormalizeMultiplayerBucket({})
    };
  }

  normalizeMultiplayerBucket = function(bucket){
    const clean = baseNormalizeMultiplayerBucket(bucket);
    const source = bucket?.byLength || {};
    clean.byLength = {
      "4":baseNormalizeMultiplayerBucket(source?.["4"]),
      "5":baseNormalizeMultiplayerBucket(source?.["5"]),
      "6":baseNormalizeMultiplayerBucket(source?.["6"])
    };
    return clean;
  };

  defaultMultiplayerStats = function(){
    const stats = baseDefaultMultiplayerStats();
    stats.overall = normalizeMultiplayerBucket(stats.overall);
    stats.kelimelik = normalizeMultiplayerBucket(stats.kelimelik);
    stats.classic = normalizeMultiplayerBucket(stats.classic);
    return stats;
  };

  /*
   * Yeni Klasik oyunlar hem eski toplu Klasik istatistiğine
   * hem de seçilen harf sayısına göre ayrı bucket'a kaydedilir.
   */
  recordGameResult = function(won, tries){
    const directClassic = gameMode === "classic";
    const playedLength = COLS;

    baseRecordGameResult(won, tries);

    if(!directClassic) return;

    const stats = loadStats();
    const key = String(playedLength);

    if(!stats.classicModeByLength){
      stats.classicModeByLength = emptyClassicLengthStats();
    }

    if(stats.classicModeByLength[key]){
      updateStatBucket(stats.classicModeByLength[key], won, tries);
      saveStats(stats);
    }
  };

  resolveStatsTab = function(category, length="4"){
    if(category === "kelimelik") return `classic${length}`;
    if(category === "classicMode") return `classicMode${length}`;
    if(category === "daily") return "daily";
    return "overall";
  };

  getStatsBucket = function(stats, tab){
    if(tab === "daily") return stats.daily;
    if(tab === "classic4") return stats.classic["4"];
    if(tab === "classic5") return stats.classic["5"];
    if(tab === "classic6") return stats.classic["6"];

    const directClassic = String(tab || "").match(/^classicMode([456])$/);
    if(directClassic){
      const key = directClassic[1];
      return stats.classicModeByLength?.[key] || emptyStatBucket();
    }

    if(tab === "classicMode") return stats.classicMode;
    return stats.overall;
  };

  statsPanelHTML = function(bucket, tab){
    const directClassic = String(tab || "").match(/^classicMode([456])$/);
    if(!directClassic) return baseStatsPanelHTML(bucket, tab);

    const length = Number(directClassic[1]);
    const visibleDistribution = bucket.guessDistribution.slice(
      0,
      classicAttemptLimit(length)
    );

    const winRate = bucket.gamesPlayed
      ? Math.round((bucket.wins / bucket.gamesPlayed) * 100)
      : 0;

    const maxGuess = Math.max(1, ...visibleDistribution);
    const hasDetail = bucket.hasDetailedGuessData !== false;

    const avgGuesses = bucket.wins && hasDetail
      ? ((Number(bucket.totalWinningGuesses) || 0) / bucket.wins).toFixed(1)
      : "—";

    const bestWin = bucket.bestWin ?? "—";

    return `
      <div class="stats-grid stats-grid-detailed">
        <div class="stat-card"><b>${bucket.gamesPlayed}</b><span>Oynanan oyun</span></div>
        <div class="stat-card"><b>%${winRate}</b><span>Kazanma oranı</span></div>
        <div class="stat-card"><b>${bucket.currentStreak}</b><span>Mevcut seri</span></div>
        <div class="stat-card"><b>${bucket.maxStreak}</b><span>En uzun seri</span></div>
        <div class="stat-card"><b>${avgGuesses}</b><span>Ort. tahmin</span></div>
        <div class="stat-card"><b>${bestWin}</b><span>En iyi sonuç</span></div>
      </div>

      <h3>Tahmin Dağılımı</h3>
      <div class="guess-distribution">
        ${visibleDistribution.map((value, index) => {
          const width = value
            ? Math.max(8, Math.round((value / maxGuess) * 100))
            : 0;

          return `
            <div class="guess-dist-row">
              <span>${index + 1}</span>
              <div class="guess-dist-track">
                <div class="guess-dist-fill" data-width="${width}"></div>
              </div>
              <span class="guess-dist-value">${value}</span>
            </div>
          `;
        }).join("")}
      </div>
    `;
  };

  /*
   * İstenen bilgi kutusu tamamen kaldırıldı.
   */
  multiplayerStatsPanelHTML = function(bucket){
    const winRate = bucket.matches
      ? Math.round((bucket.wins / bucket.matches) * 100)
      : 0;

    const avgGuesses = bucket.solvedMatches
      ? (bucket.totalSolveGuesses / bucket.solvedMatches).toFixed(1)
      : "—";

    const avgSeconds = bucket.solvedMatches
      ? Math.round((bucket.totalSolveMs / bucket.solvedMatches) / 1000)
      : null;

    const avgTime = avgSeconds === null
      ? "—"
      : `${Math.floor(avgSeconds / 60)}:${String(avgSeconds % 60).padStart(2, "0")}`;

    return `
      <div class="stats-grid stats-grid-detailed">
        <div class="stat-card"><b>${bucket.matches}</b><span>Oynanan maç</span></div>
        <div class="stat-card"><b>${bucket.wins}</b><span>Galibiyet</span></div>
        <div class="stat-card"><b>${bucket.losses}</b><span>Mağlubiyet</span></div>
        <div class="stat-card"><b>${bucket.draws}</b><span>Beraberlik</span></div>
        <div class="stat-card"><b>%${winRate}</b><span>Kazanma oranı</span></div>
        <div class="stat-card"><b>${bucket.currentStreak}</b><span>Mevcut seri</span></div>
        <div class="stat-card"><b>${bucket.maxStreak}</b><span>En uzun seri</span></div>
        <div class="stat-card"><b>${avgGuesses}</b><span>Ort. çözme tahmini</span></div>
        <div class="stat-card"><b>${avgTime}</b><span>Ort. çözme süresi</span></div>
      </div>
    `;
  };

  function combinedGeneralStatsPanelHTML(localBucket, onlineBucket){
    const local = normalizeBucket(localBucket || {});
    const online = normalizeMultiplayerBucket(onlineBucket || {});
    const totalPlayed = Number(local.gamesPlayed || 0) + Number(online.matches || 0);
    const totalWins = Number(local.wins || 0) + Number(online.wins || 0);
    const winRate = totalPlayed
      ? Math.round((totalWins / totalPlayed) * 100)
      : 0;

    return `
      <div class="stats-grid stats-grid-detailed general-all-stats">
        <div class="stat-card"><b>${totalPlayed}</b><span>Toplam oynanan</span></div>
        <div class="stat-card"><b>${totalWins}</b><span>Toplam galibiyet</span></div>
        <div class="stat-card"><b>%${winRate}</b><span>Genel kazanma oranı</span></div>
        <div class="stat-card"><b>${local.gamesPlayed}</b><span>Tek oyunculu oyun</span></div>
        <div class="stat-card"><b>${online.matches}</b><span>Online maç</span></div>
        <div class="stat-card"><b>${online.wins}</b><span>Online galibiyet</span></div>
      </div>
    `;
  }

  renderStatsTab = function(tab, category="overall", selectedLength="4"){
    if(tab === "daily") repairTodayDailyState();

    const stats = loadStats();
    const panel = $("#statsPanel");
    if(!panel) return;

    panel.innerHTML = statsPanelHTML(getStatsBucket(stats, tab), tab);

    document.querySelectorAll(".stats-tab").forEach(btn => {
      btn.classList.toggle(
        "active",
        btn.dataset.statsCategory === category
      );
    });

    document.querySelectorAll("#statsSubTabs .stats-subtab").forEach(btn => {
      btn.classList.toggle(
        "active",
        btn.dataset.statsLength === selectedLength
      );
    });

    const subTabs = $("#statsSubTabs");
    if(subTabs){
      subTabs.classList.toggle(
        "visible",
        category === "kelimelik" || category === "classicMode"
      );
    }

    applyStatsBarWidths();
  };

  function multiplayerBucketForView(stats, mode, length="all"){
    const modeBucket = stats?.[mode] || normalizeMultiplayerBucket({});
    if(mode === "overall" || length === "all") return modeBucket;
    return modeBucket?.byLength?.[String(length)] || baseNormalizeMultiplayerBucket({});
  }

  openStatsModal = function(initialCategory="overall"){
    showModal(`
      <h2>İstatistikler</h2>

      <div class="stats-tabs stats-tabs-online"
           role="tablist"
           aria-label="İstatistik modu">
        <button class="stats-tab active"
                data-stats-category="overall">Genel</button>
        <button class="stats-tab"
                data-stats-category="daily">Günlük</button>
        <button class="stats-tab"
                data-stats-category="kelimelik">Kelimelik</button>
        <button class="stats-tab"
                data-stats-category="classicMode">Klasik</button>
        <button class="stats-tab"
                data-stats-category="multiplayer">Online</button>
      </div>

      <div class="stats-subtabs"
           id="statsSubTabs"
           aria-label="Harf sayısı">
        <span>Harf sayısı</span>
        <div class="stats-subtabs-track"
             role="tablist"
             aria-label="Harf sayısı">
          <button class="stats-subtab active"
                  data-stats-length="4">4</button>
          <button class="stats-subtab"
                  data-stats-length="5">5</button>
          <button class="stats-subtab"
                  data-stats-length="6">6</button>
        </div>
      </div>

      <div class="stats-subtabs"
           id="multiplayerStatsSubTabs"
           aria-label="Online oyun modu">
        <span>Mod</span>
        <div class="stats-subtabs-track multiplayer-stats-subtabs"
             role="tablist"
             aria-label="Online oyun modu">
          <button class="stats-subtab multiplayer-subtab active"
                  data-multiplayer-mode="overall">Genel</button>
          <button class="stats-subtab multiplayer-subtab"
                  data-multiplayer-mode="kelimelik">Kelimelik</button>
          <button class="stats-subtab multiplayer-subtab"
                  data-multiplayer-mode="classic">Klasik</button>
        </div>
      </div>

      <div class="stats-subtabs"
           id="multiplayerLengthSubTabs"
           aria-label="Online harf sayısı">
        <span>Harf sayısı</span>
        <div class="stats-subtabs-track multiplayer-length-subtabs"
             role="tablist"
             aria-label="Online harf sayısı">
          <button class="stats-subtab multiplayer-length-subtab active"
                  data-multiplayer-length="all">Tümü</button>
          <button class="stats-subtab multiplayer-length-subtab"
                  data-multiplayer-length="4">4</button>
          <button class="stats-subtab multiplayer-length-subtab"
                  data-multiplayer-length="5">5</button>
          <button class="stats-subtab multiplayer-length-subtab"
                  data-multiplayer-length="6">6</button>
        </div>
      </div>

      <div id="statsPanel"></div>

    `,{
      bodyClass:"stats-modal-body",
      closeAction:showProfileModal
    });

    let currentCategory = [
      "overall",
      "daily",
      "kelimelik",
      "classicMode",
      "multiplayer"
    ].includes(initialCategory)
      ? initialCategory
      : "overall";

    let currentLength = "4";
    let currentMultiplayerMode = "overall";
    let currentMultiplayerLength = "all";

    const renderOnlineStats = stats => {
      const panel = $("#statsPanel");
      if(!panel) return;

      const bucket = multiplayerBucketForView(
        stats,
        currentMultiplayerMode,
        currentMultiplayerLength
      );
      panel.innerHTML = multiplayerStatsPanelHTML(bucket);

      document.querySelectorAll(".stats-tab").forEach(btn => {
        btn.classList.toggle(
          "active",
          btn.dataset.statsCategory === "multiplayer"
        );
      });

      document.querySelectorAll(".multiplayer-subtab").forEach(btn => {
        btn.classList.toggle(
          "active",
          btn.dataset.multiplayerMode === currentMultiplayerMode
        );
      });

      document.querySelectorAll(".multiplayer-length-subtab").forEach(btn => {
        btn.classList.toggle(
          "active",
          btn.dataset.multiplayerLength === currentMultiplayerLength
        );
      });

      $("#statsSubTabs")?.classList.remove("visible");
      $("#multiplayerStatsSubTabs")?.classList.add("visible");
      $("#multiplayerLengthSubTabs")?.classList.toggle(
        "visible",
        currentMultiplayerMode === "kelimelik" || currentMultiplayerMode === "classic"
      );
    };

    const syncStatsView = () => {
      if(currentCategory === "multiplayer"){
        renderOnlineStats(loadMultiplayerStats());

        refreshOwnOnlineStats().then(remoteStats => {
          if(currentCategory !== "multiplayer") return;
          renderOnlineStats(remoteStats);
        });
        return;
      }

      if(currentCategory === "overall"){
        const panel = $("#statsPanel");
        const localStats = loadStats();
        const cachedOnline = loadMultiplayerStats();
        if(panel){
          panel.innerHTML = combinedGeneralStatsPanelHTML(
            localStats.overall,
            cachedOnline.overall
          );
        }
        document.querySelectorAll(".stats-tab").forEach(btn => {
          btn.classList.toggle(
            "active",
            btn.dataset.statsCategory === "overall"
          );
        });
        $("#statsSubTabs")?.classList.remove("visible");
        $("#multiplayerStatsSubTabs")?.classList.remove("visible");
        $("#multiplayerLengthSubTabs")?.classList.remove("visible");

        refreshOwnOnlineStats().then(remoteStats => {
          if(currentCategory !== "overall") return;
          const currentPanel = $("#statsPanel");
          if(currentPanel){
            currentPanel.innerHTML = combinedGeneralStatsPanelHTML(
              loadStats().overall,
              remoteStats.overall
            );
          }
        });
        return;
      }

      const currentTab = resolveStatsTab(
        currentCategory,
        currentLength
      );

      renderStatsTab(
        currentTab,
        currentCategory,
        currentLength
      );

      $("#multiplayerStatsSubTabs")?.classList.remove("visible");
      $("#multiplayerLengthSubTabs")?.classList.remove("visible");
    };

    document.querySelectorAll(".stats-tab").forEach(btn => {
      btn.onclick = () => {
        currentCategory = btn.dataset.statsCategory;
        syncStatsView();
      };
    });

    document.querySelectorAll("#statsSubTabs .stats-subtab").forEach(btn => {
      btn.onclick = () => {
        currentLength = btn.dataset.statsLength || "4";
        syncStatsView();
      };
    });

    document.querySelectorAll(".multiplayer-subtab").forEach(btn => {
      btn.onclick = () => {
        currentMultiplayerMode = btn.dataset.multiplayerMode || "overall";
        currentMultiplayerLength = "all";
        currentCategory = "multiplayer";
        syncStatsView();
      };
    });

    document.querySelectorAll(".multiplayer-length-subtab").forEach(btn => {
      btn.onclick = () => {
        currentMultiplayerLength = btn.dataset.multiplayerLength || "all";
        currentCategory = "multiplayer";
        syncStatsView();
      };
    });

    syncStatsView();
  };

  async function resetEveryStatistic(){
    if(!confirm(
      "Tüm istatistikler sıfırlansın mı? Günlük bulmaca hakkın ve kelime geçmişin değişmez."
    )){
      return;
    }

    storageRemove(STATS_KEY);
    storageRemove(LEGACY_STATS_KEY);
    storageRemove(MULTIPLAYER_STATS_KEY);

    saveStats(defaultStats());
    saveMultiplayerStats(defaultMultiplayerStats());

    let onlineReset = true;
    const hasOnlineProfile = Boolean(ONLINE?.getLocalProfile?.());

    if(hasOnlineProfile && ONLINE?.isConfigured?.()){
      try{
        await ONLINE.bootstrap?.();

        const client = await ONLINE.connect();
        const {error} = await client.rpc("reset_my_multiplayer_stats");

        if(error) throw error;
      }catch(error){
        onlineReset = false;
        console.warn("Online istatistikler sıfırlanamadı:", error);
      }
    }

    showSettingsModal();

    showToast(
      onlineReset
        ? "Tüm istatistikler sıfırlandı."
        : "Cihaz istatistikleri sıfırlandı. Online istatistikler sıfırlanamadı."
    );
  }

  showSettingsModal = function(){
    const settings = loadSettings();

    showModal(`
      <h2>Ayarlar</h2>

      <div class="settings-row settings-row-first">
        <div><b>Animasyonlar</b></div>
        <label class="switch">
          <input id="animationSetting"
                 type="checkbox"
                 ${settings.animations ? "checked" : ""}>
          <span></span>
        </label>
      </div>

      <div class="settings-row">
        <div><b>Renk Körü Modu</b></div>
        <label class="switch">
          <input id="colorBlindSetting"
                 type="checkbox"
                 ${settings.colorBlind ? "checked" : ""}>
          <span></span>
        </label>
      </div>

      <div class="settings-links">
        <button class="menu-action danger-soft"
                id="resetAllStatsBtn">
          <b>Tüm İstatistikleri Sıfırla</b>
          <small>Oyun ve online maç istatistiklerini sıfırla.</small>
        </button>

        <a class="menu-action link-action"
           href="mailto:bilgehanakbas0@gmail.com?subject=Kelimelik%20Feedback">
          <b>✉ Feedback Gönder</b>
          <small>Öneri veya hata bildir.</small>
        </a>
      </div>

    `,{
      closeAction:showProfileModal
    });

    $("#animationSetting").onchange = e => {
      const next = loadSettings();
      next.animations = e.target.checked;
      saveSettings(next);
    };

    $("#colorBlindSetting").onchange = e => {
      const next = loadSettings();
      next.colorBlind = e.target.checked;
      saveSettings(next);
    };

    $("#resetAllStatsBtn").onclick = resetEveryStatistic;
  };

  const ONLINE_HISTORY_CACHE_KEY = "kelimelik-online-history-cache-v1";
  let historyViewRun = 0;

  function loadOnlineHistoryCache(){
    try{
      const value = JSON.parse(localStorage.getItem(ONLINE_HISTORY_CACHE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    }catch(error){
      return [];
    }
  }

  function saveOnlineHistoryCache(rows){
    const clean = Array.isArray(rows) ? rows.slice(0,50) : [];
    storageSet(ONLINE_HISTORY_CACHE_KEY, JSON.stringify(clean));
  }

  function normalizeOnlineHistoryRow(row){
    const word = normalizeStoredWord(row?.answerWord);
    if(!word) return null;

    const length = Number(row?.wordLength) || word.length;
    const attemptLimit = Number(row?.attemptLimit) ||
      (String(row?.mode) === "classic" ? classicAttemptLimit(length) : 8);
    const result = ["win","loss","draw"].includes(String(row?.result))
      ? String(row.result)
      : row?.won
        ? "win"
        : row?.draw
          ? "draw"
          : "loss";

    return {
      id:`online:${String(row?.matchKind || "live")}:${String(row?.id || "")}`,
      word,
      length,
      mode:String(row?.mode) === "classic" ? "classic" : "kelimelik",
      won:result === "win",
      draw:result === "draw",
      result,
      attemptsUsed:Math.max(0, Number(row?.attemptsUsed) || 0),
      attemptLimit,
      date:String(row?.endedAt || ""),
      online:true,
      matchKind:String(row?.matchKind || "private"),
      opponentNickname:String(row?.opponentNickname || "")
    };
  }

  function onlineHistoryRows(rows){
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeOnlineHistoryRow)
      .filter(Boolean);
  }

  function historyModeLabel(item){
    if(item?.online){
      const kind = item.matchKind === "bot"
        ? "Bot"
        : item.matchKind === "quick"
          ? "Hızlı"
          : "Arkadaş";
      const mode = item.mode === "classic" ? "Klasik" : "Kelimelik";
      return `Online · ${kind} · ${mode} · ${item.length} Harf`;
    }

    if(item?.mode === "daily") return "Günlük";
    if(item?.mode === "shared") return "Paylaşılan";
    if(item?.mode === "classic" || item?.gameVariant === "classic") return `Klasik · ${item?.length} Harf`;
    return `Kelimelik · ${item?.length} Harf`;
  }

  function formatHistoryTime(seconds){
    const safe = Math.max(0, Number(seconds) || 0);
    const minutes = Math.floor(safe / 60);
    const remain = safe % 60;
    return `${String(minutes).padStart(2,"0")}:${String(remain).padStart(2,"0")}`;
  }

  function historyScoreLabel(item){
    const limit = Number(item?.attemptLimit) || 8;
    const timeSuffix = Number(item?.durationSeconds) > 0
      ? ` · ${formatHistoryTime(item.durationSeconds)}`
      : "";
    if(item?.online){
      const result = item.result === "win"
        ? "Galibiyet"
        : item.result === "draw"
          ? "Berabere"
          : "Mağlubiyet";
      return `${Number(item.attemptsUsed) || 0}/${limit} · ${result}${timeSuffix}`;
    }
    return item?.won
      ? `${item.tries}/${limit}${timeSuffix}`
      : `X/${limit}${timeSuffix}`;
  }

  function combinedHistoryRows(remoteRows){
    const localRows = loadHistory().map(item=>({...item,online:false}));
    const onlineRows = onlineHistoryRows(remoteRows);
    return [...localRows,...onlineRows]
      .sort((a,b)=>(Date.parse(b?.date)||0)-(Date.parse(a?.date)||0))
      .slice(0,50);
  }

  function renderHistoryContent(remoteRows,{loading=false,failed=false}={}){
    const history = combinedHistoryRows(remoteRows);
    const favorites = loadFavorites();

    const favoriteHtml = favorites.size
      ? `<div class="favorite-tags">
          ${[...favorites].sort().map(word=>`
            <button class="favorite-tag" data-meaning-word="${escapeHTML(word)}">★ ${escapeHTML(word)}</button>
          `).join("")}
         </div>`
      : `<p class="empty-state">Henüz favori kelime yok.</p>`;

    const historyHtml = history.length
      ? history.map(item=>{
          const unresolvedDaily = !item.online && item.mode === "daily" && !item.won;
          const visibleWord = unresolvedDaily ? "ÇÖZÜLEMEDİ" : item.word;
          const onlineBadge = item.online
            ? `<span class="history-online-badge">ONLINE</span>`
            : "";

          return `
            <article class="history-item ${item.online ? "history-item-online" : ""}">
              <span class="history-favorite history-favorite-muted" aria-hidden="true">•</span>

              <div>
                <b>${escapeHTML(visibleWord)} ${onlineBadge}</b>
                <span>${escapeHTML(historyModeLabel(item))} · ${escapeHTML(historyScoreLabel(item))}</span>
              </div>

              ${unresolvedDaily
                ? `<span class="history-meaning history-meaning-muted">—</span>`
                : `<button class="history-meaning"
                          data-meaning-word="${escapeHTML(item.word)}">Anlamı</button>`
              }
            </article>
          `;
        }).join("")
      : `<p class="empty-state">Henüz tamamlanmış oyun yok.</p>`;

    const syncText = loading
      ? `<p class="history-sync-note">Online maç geçmişi yükleniyor…</p>`
      : failed
        ? `<p class="history-sync-note history-sync-error">Online maç geçmişi şu anda alınamadı.</p>`
        : "";

    showModal(`
      <h2>Kelime Geçmişi</h2>
      <h3>Favoriler</h3>
      ${favoriteHtml}

      <h3>Son Oyunlar</h3>
      <p class="history-limit-note">Son 50 tamamlanmış oyun gösterilir.</p>
      ${syncText}
      <div class="history-list" id="historyList">${historyHtml}</div>
    `,{closeAction:showProfileModal});

    document.querySelectorAll("[data-meaning-word]").forEach(btn=>{
      btn.onclick=()=>showWordMeaning(btn.dataset.meaningWord,{
        backAction:showHistoryModal
      });
    });
  }

  showHistoryModal = async function(){
    const run = ++historyViewRun;
    const cached = loadOnlineHistoryCache();
    const canSync = Boolean(
      ONLINE?.isConfigured?.() &&
      ONLINE?.getLocalProfile?.() &&
      ONLINE?.getRecentMatchHistory
    );

    renderHistoryContent(cached,{loading:canSync && cached.length===0});
    if(!canSync) return;

    try{
      const remote = await ONLINE.getRecentMatchHistory(50);
      if(run !== historyViewRun || !$("#historyList")) return;
      saveOnlineHistoryCache(remote);
      renderHistoryContent(remote);
    }catch(error){
      console.warn("Online maç geçmişi alınamadı:",error);
      if(run !== historyViewRun || !$("#historyList")) return;
      renderHistoryContent(cached,{failed:true});
    }
  };

  showProfileSetup = function({
    returnTo=null,
    editing=false,
    backTo=null
  }={}){
    const current = ONLINE?.getLocalProfile?.() || null;
    const title = editing
      ? "Profili Düzenle"
      : "Oyuncu Profilin";

    const lead = editing
      ? "Takma adını değiştirebilirsin. Oyuncu kodun aynı kalır."
      : "Online oyunlar için önce bir takma ad seç.";

    const closeTarget = editing
      ? (typeof returnTo === "function" ? returnTo : null)
      : (typeof backTo === "function" ? backTo : null);

    showModal(`
      <h2>${title}</h2>
      <p>${lead}</p>

      <form class="profile-form"
            id="profileForm"
            novalidate>
        <label class="profile-label"
               for="profileNickname">Takma Ad</label>

        <input class="profile-input"
               id="profileNickname"
               maxlength="18"
               autocomplete="nickname"
               value="${escapeHTML(current?.nickname || "")}">

        <p class="profile-help">2–18 karakterli bir kelime yazın.</p>

        <p class="profile-error"
           id="profileError"
           role="alert"></p>

        <button class="start-btn"
                id="saveProfileBtn"
                type="submit">
          ${editing ? "Kaydet" : "Profili Oluştur"}
        </button>
      </form>

    `,{
      closeAction:closeTarget
    });

    const input = $("#profileNickname");
    const form = $("#profileForm");
    const errorEl = $("#profileError");
    const button = $("#saveProfileBtn");

    input?.focus();

    form.onsubmit = async event => {
      event.preventDefault();

      const valid =
        ONLINE?.validateNickname?.(input.value) ||
        {
          ok:false,
          message:"Profil sistemi yüklenemedi."
        };

      if(!valid.ok){
        errorEl.textContent = valid.message;
        return;
      }

      button.disabled = true;
      button.textContent = "Kaydediliyor…";
      errorEl.textContent = "";

      try{
        const profile = await ONLINE.saveProfile(valid.nickname);

        showToast(
          profile.synced
            ? "Online profil hazır."
            : "Profil bu cihaza kaydedildi."
        );

        if(typeof returnTo === "function"){
          returnTo();
        }else{
          showProfileModal();
        }
      }catch(error){
        errorEl.textContent = String(
          error?.message || "Profil kaydedilemedi."
        );

        button.disabled = false;
        button.textContent = editing
          ? "Kaydet"
          : "Profili Oluştur";
      }
    };
  };

  showProfileModal = function(){
    const profile = ONLINE?.getLocalProfile?.() || null;

    if(!profile){
      showProfileSetup();
      return;
    }

    showModal(`
      <h2>Profil</h2>

      ${profileCardHTML(profile)}

      <div class="profile-actions">
        <button class="modal-back-btn"
                id="editProfileBtn">Takma Adı Düzenle</button>

        <button class="modal-back-btn"
                id="profileStatsBtn">İstatistikler</button>

        <button class="modal-back-btn"
                id="profileSettingsBtn">Ayarlar</button>

        <button class="modal-back-btn profile-history-btn"
                id="profileHistoryBtn">Kelime Geçmişi & Favoriler</button>
      </div>
    `);

    $("#editProfileBtn").onclick = () => showProfileSetup({
      returnTo:showProfileModal,
      editing:true
    });

    $("#profileStatsBtn").onclick = () => openStatsModal("overall");
    $("#profileSettingsBtn").onclick = showSettingsModal;
    $("#profileHistoryBtn").onclick = showHistoryModal;
  };

  showDirectClassicLengthSelector = function(){
    showModal(`
      <h2>Klasik Mod</h2>
      <p>Kelime uzunluğunu seç. Harfler her tahminden sonra doğrudan renklenir.</p>

      <div class="length-options classic-length-options">
        <button class="length-btn" data-classic-length="4">
          <strong>4 harf</strong>
          <small>5 tahmin</small>
        </button>

        <button class="length-btn classic-standard-option" data-classic-length="5">
          <strong>5 harf</strong>
          <small>6 tahmin</small>
          <span class="classic-standard-badge">standart</span>
        </button>

        <button class="length-btn" data-classic-length="6">
          <strong>6 harf</strong>
          <small>7 tahmin</small>
        </button>
      </div>

    `,{closeAction:showNewGameSelector});

    document.querySelectorAll("[data-classic-length]").forEach(btn => {
      btn.onclick = () => {
        const length = Number(btn.dataset.classicLength);
        closeModal();
        if(newGame("classic", length)) showGame();
      };
    });
  };

  /*
   * Özel bulmaca cevabı istemci ve backend'de aynı kontrollü kelime havuzuna
   * göre doğrulanır. TDK anlam servisi kullanıcıya anlam göstermek için kalır;
   * güvenlik/izin kararı olarak kullanılmaz. Böylece RPC doğrudan çağrılsa bile
   * backend aynı kurala sahip olur.
   */
  async function customWordIsValid(answer, length){
    const pool = WORD_POOLS[String(length)] || [];
    return pool.includes(answer);
  }

  showCustomPuzzleBuilder = function(){
    const profile = ONLINE?.getLocalProfile?.() || null;

    if(!profile){
      showProfileSetup({
        returnTo:showCustomPuzzleBuilder,
        backTo:showShareMenu,
        backLabel:"Paylaş'a Dön"
      });
      return;
    }

    if(!ONLINE?.isConfigured?.()){
      showCustomPuzzleBackendRequired();
      return;
    }

    showModal(`
      <h2>✏️ Kendi Bulmacanı Oluştur</h2>

      <p>
        Arkadaşına özel gizli kelime seç.
        Kelime URL'de hiçbir zaman yer almaz.
      </p>

      <section class="custom-puzzle-builder">
        <div class="live-mode-toggle"
             role="group"
             aria-label="Özel bulmaca modu">
          <button class="live-mode-btn active"
                  data-custom-build-mode="kelimelik">◆ Kelimelik</button>
          <button class="live-mode-btn"
                  data-custom-build-mode="classic">▦ Klasik</button>
        </div>

        <div class="live-length-wrap"
             id="customBuildLengthWrap">
          <span>Harf sayısı</span>

          <div class="live-length-toggle">
            <button data-custom-build-length="4">4</button>
            <button class="active"
                    data-custom-build-length="5">5</button>
            <button data-custom-build-length="6">6</button>
          </div>
        </div>

        <label class="profile-label"
               for="customSecretInput">Gizli Kelime</label>

        <input class="profile-input custom-secret-input"
               id="customSecretInput"
               maxlength="6"
               autocomplete="off"
               spellcheck="false">

        <p class="profile-help">
          Gerçek bir kelime yazın. Özel isimler de kullanılabilir.
        </p>

        <p class="profile-error"
           id="customPuzzleError"
           role="alert"></p>

        <button class="start-btn"
                id="createCustomPuzzleSubmit">
          Bulmacayı Oluştur
        </button>
      </section>

      <button class="modal-back-btn"
              id="customPuzzleBackBtn">← Paylaş'a Dön</button>
    `,{
      closeAction:showShareMenu
    });

    let mode = "kelimelik";
    let length = 5;

    const lengthWrap = $("#customBuildLengthWrap");
    const input = $("#customSecretInput");
    const errorEl = $("#customPuzzleError");

    document.querySelectorAll("[data-custom-build-mode]").forEach(btn => {
      btn.onclick = () => {
        mode = btn.dataset.customBuildMode;

        document.querySelectorAll("[data-custom-build-mode]").forEach(x => {
          x.classList.toggle("active", x === btn);
        });

        lengthWrap.hidden = false;
        input.maxLength = length;
        input.value = [...input.value].slice(0, length).join("");
        errorEl.textContent = "";
      };
    });

    document.querySelectorAll("[data-custom-build-length]").forEach(btn => {
      btn.onclick = () => {
        length = Number(btn.dataset.customBuildLength);

        input.maxLength = length;
        input.value = [...input.value].slice(0, length).join("");

        document.querySelectorAll("[data-custom-build-length]").forEach(x => {
          x.classList.toggle("active", x === btn);
        });

        errorEl.textContent = "";
      };
    });

    input.addEventListener("input", () => {
      input.value = String(input.value || "")
        .toLocaleUpperCase("tr-TR")
        .replace(/[^A-ZÇĞİÖŞÜ]/g, "")
        .slice(0, length);

      errorEl.textContent = "";
    });

    input.focus();

    $("#createCustomPuzzleSubmit").onclick = async () => {
      const answer = String(input.value || "")
        .toLocaleUpperCase("tr-TR");

      const button = $("#createCustomPuzzleSubmit");

      if([...answer].length !== length){
        errorEl.textContent =
          `${length} harfli bir kelime gir.`;
        return;
      }

      button.disabled = true;
      button.textContent = "Doğrulanıyor…";
      errorEl.textContent = "";

      const valid = await customWordIsValid(answer, length);

      if(!valid){
        errorEl.textContent =
          "Bu kelime henüz desteklenmiyor. Başka bir kelime deneyin.";

        button.disabled = false;
        button.textContent = "Bulmacayı Oluştur";
        return;
      }

      button.textContent = "Oluşturuluyor…";

      try{
        const created = await ONLINE.createCustomPuzzle(
          mode,
          length,
          answer
        );

        showCustomPuzzleCreated(created);
      }catch(error){
        errorEl.textContent = String(
          error?.message ||
          "Özel bulmaca oluşturulamadı."
        );

        button.disabled = false;
        button.textContent = "Bulmacayı Oluştur";
      }
    };

    $("#customPuzzleBackBtn").onclick = showShareMenu;
  };

  /*
   * Çok Oyunculu ekranındaki ayrı "Profil" butonu kaldırıldı.
   * Burada yalnızca oyuncu adı ve oyuncu kodu gösterilir.
   */
  showMultiplayerMenu = function(){
    const profile = ONLINE?.getLocalProfile?.() || null;

    if(!profile){
      showProfileSetup({
        returnTo:showMultiplayerMenu,
        backTo:showNewGameSelector
      });
      return;
    }

    const onlineReady = Boolean(ONLINE?.isConfigured?.());

    showModal(`
      <h2>Çok Oyunculu</h2>

      <div class="multiplayer-profile-strip">
        <div class="multiplayer-profile-identity">
          <strong>${escapeHTML(profile.nickname)}</strong>
          <small>#${escapeHTML(profile.playerCode)}</small>
        </div>
      </div>

      <p>${
        onlineReady
          ? "Arkadaşınla oyna, hızlı eşleşmeye gir veya bot rakip seç."
          : "Arkadaşınla oyun, hızlı eşleşme ve bot seçenekleri burada yer alır."
      }</p>

      <div class="menu-list">
        <button class="menu-action" id="friendLiveGameBtn">
          <b>👥 Arkadaşınla Oyna</b>
          <small>Özel oda oluştur. Davet bağlantısını gönder. Arkadaşınla aynı bulmaca üzerinde yarış</small>
        </button>

        <button class="menu-action" id="quickMatchBtn">
          <b>⚔️ Hızlı Eşleşme</b>
          <small>Aynı moddaki çevrimiçi oyuncularla yarış</small>
        </button>

        <button class="menu-action" id="botMatchBtn">
          <b>🤖 Bot Rakip</b>
          <small>İnsan temposuna sahip botlarla yarış</small>
        </button>
      </div>

    `,{closeAction:showNewGameSelector});

    $("#friendLiveGameBtn").onclick = onlineReady
      ? showFriendLiveSetup
      : () => showOnlineSetupRequired(showMultiplayerMenu);
    $("#quickMatchBtn").onclick = onlineReady
      ? showQuickMatchSetup
      : () => showOnlineSetupRequired(showMultiplayerMenu);
    $("#botMatchBtn").onclick = onlineReady
      ? showBotMatchSetup
      : () => showOnlineSetupRequired(showMultiplayerMenu);
  };


  /*
   * app.js yüklenirken profil butonuna eski showProfileModal bağlanmıştı.
   * Yeni fonksiyonu tekrar bağlıyoruz.
   */
  const profileButton = $("#profileBtn");
  if(profileButton){
    profileButton.onclick = showProfileModal;
  }
})();
