/* =========================================================================
   Dra. Laís Caroline Hahmed — comportamento da página
   Sem bibliotecas externas. Nenhum dado é enviado para fora do navegador.
   ========================================================================= */
(function () {
  'use strict';

  /* -----------------------------------------------------------------------
     CONFIGURAÇÃO
     >>> ÚNICO PONTO A EDITAR: o endereço da página de agendamento da
         PLATAFORMA PRÓPRIA. Todos os botões de agendamento do site apontam
         para ele automaticamente.

     A plataforma é nossa (agendamento, teleconsulta e prontuário no mesmo
     lugar) — o Doctoralia deixou de ser usado. Histórico da decisão e
     detalhes técnicos: plataforma/README.md.

     Em produção a plataforma responde em consulta.dralaishahmed.com.br
     (DNS + nginx em infra/). Para testar com ela rodando localmente,
     troque temporariamente por http://localhost:3000/agendar.
     ----------------------------------------------------------------------- */
  var CONFIG = {
    PLATAFORMA_TELEMEDICINA: 'https://consulta.dralaishahmed.com.br/agendar',

    // Usado apenas enquanto o endereço acima estiver em branco.
    FALLBACK: 'https://wa.me/5567991873948?text=Ol%C3%A1%2C%20Dra.%20La%C3%ADs!%20Gostaria%20de%20agendar%20uma%20teleconsulta.',

    // Texto do aviso de privacidade: troque a versão para reexibir o aviso
    // a todos os visitantes (ex.: após atualizar a Política de Privacidade).
    VERSAO_AVISO_PRIVACIDADE: '2026-08'
  };

  var $  = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* -----------------------------------------------------------------------
     1. Link da plataforma de telemedicina
     ----------------------------------------------------------------------- */
  function aplicarLinkPlataforma() {
    var url = (CONFIG.PLATAFORMA_TELEMEDICINA || '').trim();
    var configurado = url.length > 0;
    var destino = configurado ? url : CONFIG.FALLBACK;

    if (!configurado) {
      console.warn(
        '[site] Plataforma de telemedicina ainda não configurada. ' +
        'Edite CONFIG.PLATAFORMA_TELEMEDICINA em assets/js/main.js. ' +
        'Enquanto isso, os botões direcionam para o WhatsApp.'
      );
    }

    $$('[data-link="telemedicina"]').forEach(function (el) {
      el.setAttribute('href', destino);
      el.setAttribute('target', '_blank');
      el.setAttribute('rel', 'noopener noreferrer');
      el.dataset.configurado = configurado ? 'sim' : 'nao';
      if (!configurado) {
        el.setAttribute('title', 'Agendamento via WhatsApp enquanto a plataforma não é configurada');
      }
    });
  }

  /* -----------------------------------------------------------------------
     2. Tema claro/escuro
     ----------------------------------------------------------------------- */
  function iniciarTema() {
    var botao = $('#theme-toggle');
    if (!botao) { return; }

    var raiz = document.documentElement;
    var midia = window.matchMedia('(prefers-color-scheme: dark)');

    function aplicar(tema, persistir) {
      raiz.setAttribute('data-theme', tema);
      botao.setAttribute('aria-label',
        tema === 'dark' ? 'Ativar tema claro' : 'Ativar tema escuro');
      if (persistir) {
        try { localStorage.setItem('tema', tema); } catch (e) { /* modo privado */ }
      }
    }

    var salvo = null;
    try { salvo = localStorage.getItem('tema'); } catch (e) { /* modo privado */ }
    aplicar(salvo || (midia.matches ? 'dark' : 'light'), false);

    botao.addEventListener('click', function () {
      aplicar(raiz.getAttribute('data-theme') === 'dark' ? 'light' : 'dark', true);
    });

    // Acompanha o sistema enquanto o visitante não escolher manualmente.
    midia.addEventListener('change', function (ev) {
      var escolha = null;
      try { escolha = localStorage.getItem('tema'); } catch (e) { /* modo privado */ }
      if (!escolha) { aplicar(ev.matches ? 'dark' : 'light', false); }
    });
  }

  /* -----------------------------------------------------------------------
     3. Menu mobile
     ----------------------------------------------------------------------- */
  function iniciarMenu() {
    var botao = $('#menu-toggle');
    var nav = $('#nav-principal');
    if (!botao || !nav) { return; }

    function fechar() {
      nav.classList.remove('is-open');
      botao.setAttribute('aria-expanded', 'false');
      botao.setAttribute('aria-label', 'Abrir menu');
    }

    botao.addEventListener('click', function () {
      var aberto = nav.classList.toggle('is-open');
      botao.setAttribute('aria-expanded', String(aberto));
      botao.setAttribute('aria-label', aberto ? 'Fechar menu' : 'Abrir menu');
    });

    $$('a', nav).forEach(function (link) { link.addEventListener('click', fechar); });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && nav.classList.contains('is-open')) {
        fechar();
        botao.focus();
      }
    });

    document.addEventListener('click', function (ev) {
      if (nav.classList.contains('is-open') &&
          !nav.contains(ev.target) && !botao.contains(ev.target)) {
        fechar();
      }
    });

    window.addEventListener('resize', function () {
      if (window.innerWidth > 860) { fechar(); }
    });
  }

  /* -----------------------------------------------------------------------
     4. Cabeçalho fixo + seção ativa na navegação
     ----------------------------------------------------------------------- */
  function iniciarScroll() {
    var header = $('.site-header');
    var links = $$('.nav-list a[href^="#"]');
    var secoes = links
      .map(function (a) { return document.getElementById(a.getAttribute('href').slice(1)); })
      .filter(Boolean);

    var pendente = false;
    function atualizar() {
      if (header) { header.classList.toggle('is-stuck', window.scrollY > 8); }

      var alvo = window.scrollY + window.innerHeight * 0.32;
      var ativa = null;
      secoes.forEach(function (sec) {
        if (sec.offsetTop <= alvo) { ativa = sec.id; }
      });
      links.forEach(function (a) {
        a.classList.toggle('is-active', a.getAttribute('href') === '#' + ativa);
      });
      pendente = false;
    }

    window.addEventListener('scroll', function () {
      if (!pendente) { pendente = true; window.requestAnimationFrame(atualizar); }
    }, { passive: true });

    atualizar();
  }

  /* -----------------------------------------------------------------------
     5. Revelação suave dos blocos
     ----------------------------------------------------------------------- */
  function iniciarReveal() {
    var alvos = $$('.reveal');
    if (!alvos.length) { return; }

    var reduzir = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduzir || !('IntersectionObserver' in window)) {
      alvos.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }

    var obs = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('is-visible');
          obs.unobserve(entrada.target);
        }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.12 });

    alvos.forEach(function (el, i) {
      el.style.transitionDelay = (Math.min(i % 4, 3) * 70) + 'ms';
      obs.observe(el);
    });
  }

  /* -----------------------------------------------------------------------
     6. Aviso de privacidade (LGPD)
     ----------------------------------------------------------------------- */
  function iniciarAvisoPrivacidade() {
    var barra = $('#aviso-privacidade');
    if (!barra) { return; }

    var chave = 'aviso-privacidade';
    var visto = null;
    try { visto = localStorage.getItem(chave); } catch (e) { /* modo privado */ }
    if (visto === CONFIG.VERSAO_AVISO_PRIVACIDADE) { return; }

    barra.hidden = false;
    window.setTimeout(function () { barra.classList.add('is-visible'); }, 900);

    $$('[data-privacy-dismiss]', barra).forEach(function (botao) {
      botao.addEventListener('click', function () {
        barra.classList.remove('is-visible');
        window.setTimeout(function () { barra.hidden = true; }, 450);
        try { localStorage.setItem(chave, CONFIG.VERSAO_AVISO_PRIVACIDADE); } catch (e) { /* modo privado */ }
      });
    });
  }

  /* -----------------------------------------------------------------------
     7. Detalhes finais
     ----------------------------------------------------------------------- */
  function iniciarDetalhes() {
    var ano = $('#ano');
    if (ano) { ano.textContent = String(new Date().getFullYear()); }

    // Sem foto disponível: remove a <img> quebrada e mantém o monograma.
    var retrato = $('[data-portrait]');
    if (retrato) {
      retrato.addEventListener('error', function () { retrato.remove(); });
      if (retrato.complete && retrato.naturalWidth === 0) { retrato.remove(); }
    }
  }

  /* ----------------------------------------------------------------------- */
  function iniciar() {
    aplicarLinkPlataforma();
    iniciarTema();
    iniciarMenu();
    iniciarScroll();
    iniciarReveal();
    iniciarAvisoPrivacidade();
    iniciarDetalhes();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
