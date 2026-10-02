/** Queue GA events before hydration, then fetch its library on the first reader input. */
export const analyticsBootstrap = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-059PVYBN82');
  (function(){
    var requested = false;
    function loadAnalytics(){
      if (requested) return;
      requested = true;
      window.removeEventListener('pointerdown', loadAnalytics);
      window.removeEventListener('keydown', loadAnalytics);
      window.removeEventListener('scroll', loadAnalytics);
      var script = document.createElement('script');
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=G-059PVYBN82';
      document.head.appendChild(script);
    }
    window.addEventListener('pointerdown', loadAnalytics, { passive: true });
    window.addEventListener('keydown', loadAnalytics);
    window.addEventListener('scroll', loadAnalytics, { passive: true });
  })();
`;
