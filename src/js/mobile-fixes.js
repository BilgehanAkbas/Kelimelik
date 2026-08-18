(()=>{
  "use strict";

  const MOBILE_MAX=760;


  /* Modal X hizalaması app.js içinde tek kaynaktan yönetilir. */

  /* On mobile the center chip only needs the mode name; the timer keeps priority. */
  if(typeof gameModeLabelText==="function"){
    const baseGameModeLabelText=gameModeLabelText;
    gameModeLabelText=function(){
      if(window.innerWidth<=MOBILE_MAX){
        if(gameMode==="daily")return "Günlük";
        if(gameMode==="classic")return "Klasik";
        if(gameMode==="shared")return isClassicVariant()?"Klasik":"Kelimelik";
        return "Kelimelik";
      }
      return baseGameModeLabelText();
    };

    const refreshModeStrip=()=>{
      try{updateGameModeStrip?.();}catch(error){}
    };
    window.addEventListener("resize",refreshModeStrip,{passive:true});
    refreshModeStrip();
  }

  /*
   * ui-patches.js merges local + online history but intentionally rendered a
   * muted placeholder in the favorite column. Restore the real favorite action
   * after every history render without duplicating the history/sync logic.
   */
  function enhanceHistoryFavorites(root=document){
    if(typeof loadFavorites!=="function" || typeof toggleFavorite!=="function")return;
    const favorites=loadFavorites();

    root.querySelectorAll?.(".history-item").forEach(article=>{
      if(article.querySelector("[data-favorite-word]"))return;

      const placeholder=article.querySelector(".history-favorite-muted");
      const meaningButton=article.querySelector("[data-meaning-word]");
      const heading=article.querySelector("b");
      const fallbackWord=String(heading?.textContent||"").replace(/\s*ONLINE\s*$/i,"").trim();
      const word=String(meaningButton?.dataset?.meaningWord||fallbackWord||"").trim().toLocaleUpperCase("tr-TR");
      if(!placeholder || !word || word==="ÇÖZÜLEMEDİ")return;

      const button=document.createElement("button");
      const active=favorites.has(word);
      button.type="button";
      button.className="history-favorite";
      button.dataset.favoriteWord=word;
      button.setAttribute("aria-label",`${word} kelimesini ${active?"favorilerden çıkar":"favorilere ekle"}`);
      button.setAttribute("aria-pressed",active?"true":"false");
      button.textContent=active?"★":"☆";

      button.addEventListener("click",event=>{
        event.preventDefault();
        event.stopPropagation();
        toggleFavorite(word);
        if(typeof showHistoryModal==="function"){
          showHistoryModal();
        }else{
          const nowActive=loadFavorites().has(word);
          button.textContent=nowActive?"★":"☆";
          button.setAttribute("aria-pressed",nowActive?"true":"false");
        }
      });

      placeholder.replaceWith(button);
    });
  }

  const modalBody=document.getElementById("modalBody");
  if(modalBody && typeof MutationObserver!=="undefined"){
    const observer=new MutationObserver(()=>enhanceHistoryFavorites(modalBody));
    observer.observe(modalBody,{childList:true,subtree:true});
  }

  if(document.readyState==="loading"){
    document.addEventListener("DOMContentLoaded",()=>enhanceHistoryFavorites(document),{once:true});
  }else{
    enhanceHistoryFavorites(document);
  }
})();
