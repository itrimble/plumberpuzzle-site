// TODO(sponsors): set data-sponsors-live="true" on .sp-sponsors once https://github.com/sponsors/itrimble is live.
(function(){var s=document.querySelector('.sp-sponsors');if(!s||s.getAttribute('data-sponsors-live')!=='true')return;
s.querySelectorAll('a[data-live-href]').forEach(function(a){a.href=a.getAttribute('data-live-href');});})();
