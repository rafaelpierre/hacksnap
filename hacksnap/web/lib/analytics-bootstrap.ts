/** Start GA asynchronously, including visits with no pointer, keyboard, or scroll input. */
export const analyticsBootstrap = `
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());
  gtag('config', 'G-059PVYBN82');
  (function(){
      if (document.getElementById('google-analytics-library')) return;
      var script = document.createElement('script');
      script.id = 'google-analytics-library';
      script.async = true;
      script.src = 'https://www.googletagmanager.com/gtag/js?id=G-059PVYBN82';
      document.head.appendChild(script);
  })();
`;
