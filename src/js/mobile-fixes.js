(()=>{
  "use strict";

  const MOBILE_MAX=760;


  /*
   * app.js başlığı X düğmesinden kısa olduğunda negatif merkezleme
   * farkını sıfırlıyordu. Bu da Privacy / Nasıl oynanır gibi iç içe
   * başlıklarda X'i birkaç piksel aşağıda bırakıyordu. Başlığın ve
   * düğmenin gerçek yüksekliklerini tam merkezleyerek Çok Oyunculu
   * ekranındaki görsel ekseni tüm modallara taşır.
   */
  if(typeof alignModalCloseButton==="function"){
    alignModalCloseButton=function(){
      const body=document.getElementById("modalBody");
      const modal=body?.parentNode;
      const close=document.getElementById("modalClose");
      if(!modal || !close)return;

      if(typeof modal.style?.removeProperty==="function"){
        modal.style.removeProperty("--modal-close-top");
      }

      const heading=body.querySelector?.("h2");
      if(!heading)return;

      const modalRect=modal.getBoundingClientRect?.();
      const headingRect=heading.getBoundingClientRect?.();
      const closeRect=close.getBoundingClientRect?.();
      if(!modalRect || !headingRect)return;

      const closeHeight=Number(closeRect?.height)||44;
      const headingHeight=Number(headingRect?.height)||closeHeight;
      const relativeTop=(Number(headingRect.top)||0)-(Number(modalRect.top)||0)
        + ((headingHeight-closeHeight)/2);
      const minTop=window.innerWidth<=MOBILE_MAX?8:10;

      modal.style.setProperty(
        "--modal-close-top",
        `${Math.max(minTop,Math.round(relativeTop))}px`
      );
    };
  }

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
