const revealEls = document.querySelectorAll(".reveal");

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("visible");
        observer.unobserve(entry.target);
      }
    });
  },
  { threshold: 0.2 }
);

revealEls.forEach((el) => observer.observe(el));

const nav = document.getElementById("nav");
window.addEventListener("scroll", () => {
  nav.style.boxShadow = window.scrollY > 10 ? "0 1px 0 rgba(0,0,0,0.06)" : "none";
});

// Proof screenshots (.proof-thumb): click to open full-size in a shared
// lightbox, animating (FLIP technique) from the exact clicked thumbnail's
// on-screen position/size to the full lightbox size, and back again on
// close — not a generic center-screen zoom.
const lightbox = document.getElementById("lightbox");
if (lightbox) {
  const lightboxImg = document.getElementById("lightboxImg");
  const FLIP_MS = 350;
  let activeThumbImg = null;

  // Transform that makes the (already full-size, laid-out) lightbox image
  // visually sit exactly where `el` currently is on screen.
  function flipTransformFrom(el) {
    const from = el.getBoundingClientRect();
    const to = lightboxImg.getBoundingClientRect();
    const scaleX = from.width / to.width;
    const scaleY = from.height / to.height;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2);
    const dy = from.top + from.height / 2 - (to.top + to.height / 2);
    return `translate(${dx}px, ${dy}px) scale(${scaleX}, ${scaleY})`;
  }

  function openLightbox(thumbImg) {
    activeThumbImg = thumbImg;
    lightboxImg.src = thumbImg.src;
    lightboxImg.alt = thumbImg.alt || "";
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";

    const playIn = () => {
      // Snap to the thumbnail's rect with no transition, then release to
      // the resting transform (none) so the change animates naturally.
      lightboxImg.style.transition = "none";
      lightboxImg.style.transform = flipTransformFrom(thumbImg);
      lightbox.classList.add("open");
      void lightboxImg.offsetWidth;
      lightboxImg.style.transition = "";
      requestAnimationFrame(() => {
        lightboxImg.style.transform = "none";
      });
    };

    if (lightboxImg.complete) playIn();
    else lightboxImg.onload = playIn;
  }

  function closeLightbox() {
    if (activeThumbImg) {
      lightboxImg.style.transform = flipTransformFrom(activeThumbImg);
    }
    lightbox.classList.remove("open");
    document.body.style.overflow = "";
    window.setTimeout(() => {
      lightbox.hidden = true;
      lightboxImg.src = "";
      lightboxImg.style.transform = "";
      activeThumbImg = null;
    }, FLIP_MS);
  }

  document.querySelectorAll(".proof-thumb").forEach((thumb) => {
    thumb.addEventListener("click", () => {
      openLightbox(thumb.querySelector("img"));
    });
  });

  // Any click inside the lightbox closes it — backdrop, image, or the
  // close button all shrink it back to the thumbnail it came from.
  lightbox.addEventListener("click", closeLightbox);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.hidden) closeLightbox();
  });
}

function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

function easeInCubic(t) {
  return t * t * t;
}

// progress: 0-1 across the whole scroll-jacked section.
// Returns { scale, holdProgress } where holdProgress is 0-1 within the
// "settled, full-size" middle window (used by sections that step through
// sub-stages while zoomed in, e.g. the data-flow walkthrough).
function computeZoom(progress, { rampIn, rampOut, minScale, maxScale, rampOutMinScale }) {
  const holdFrac = 1 - rampIn - rampOut;
  const outMin = rampOutMinScale === undefined ? minScale : rampOutMinScale;
  let scale;
  let holdProgress;
  if (progress < rampIn) {
    scale = minScale + (maxScale - minScale) * easeOutCubic(progress / rampIn);
    holdProgress = 0;
  } else if (rampOut > 0 && progress > 1 - rampOut) {
    const t = (progress - (1 - rampOut)) / rampOut;
    scale = maxScale - (maxScale - outMin) * easeInCubic(t);
    holdProgress = 1;
  } else {
    scale = maxScale;
    holdProgress = holdFrac > 0 ? Math.min(Math.max((progress - rampIn) / holdFrac, 0), 1) : 0;
  }
  return { scale, holdProgress };
}

// Three architecture diagrams pinned in the SAME viewport spot, cross-fading
// into one another as the user scrolls — one continuous scroll-jacked scene
// rather than three separate stacked sections.
const archScrolly = document.getElementById("archScrolly");
const archSticky = document.getElementById("archSticky");
const flowSvg = document.getElementById("flowSvg");

// Shared between the two blocks below: the data-flow walkthrough's state is
// driven by the outer architecture scroll handler, but owned by the inner
// block (it knows about the SVG's paths/boxes).
let currentStage = 0;
let lastStage = 6;
let renderStage = () => {};
let scrollToDataflowStage = () => {};

if (archScrolly && archSticky) {
  const sceneOverview = document.getElementById("sceneOverview");
  const sceneDataflow = document.getElementById("sceneDataflow");

  // Zoom by resizing the diagram's actual layout width (not a CSS transform
  // scale) so the SVG is re-rendered crisply at every size instead of being
  // rasterized once and stretched blurry.
  const diagramOverview = sceneOverview.querySelector(".diagram-wrap");
  const diagramDataflow = sceneDataflow.querySelector(".diagram-wrap");
  [diagramOverview, diagramDataflow].forEach((el) => {
    el.style.maxWidth = "none";
    el.style.transition = "width 0.05s linear";
  });

  // Each scene's SVG (for its intrinsic aspect ratio) and the heading/lead/
  // controls block above it (so we know how much vertical room is left for
  // the diagram itself). Used to cap width so the diagram — and everything
  // above it — always fits in one viewport with no internal scrolling.
  const chromeOverview = sceneOverview.querySelector(".section-inner");
  const chromeDataflow = sceneDataflow.querySelector(".section-inner");
  const svgOverview = diagramOverview.querySelector("svg");
  const svgDataflow = diagramDataflow.querySelector("svg");

  function svgAspect(svg) {
    const vb = svg && svg.viewBox && svg.viewBox.baseVal;
    return vb && vb.width ? vb.height / vb.width : 0.6;
  }

  function applyZoomWidth(el, svg, chromeEl, scale) {
    const containerWidth = archSticky.clientWidth;
    const containerHeight = archSticky.clientHeight;
    const chromeHeight = chromeEl ? chromeEl.offsetHeight : 0;
    const chromeMarginBottom = chromeEl ? parseFloat(getComputedStyle(chromeEl).marginBottom) || 0 : 0;
    const innerEl = el.parentElement;
    const innerCS = getComputedStyle(innerEl);
    const wrapCS = getComputedStyle(el);
    const verticalPadding = (parseFloat(innerCS.paddingTop) || 0) + (parseFloat(innerCS.paddingBottom) || 0);
    const wrapMargin = (parseFloat(wrapCS.marginTop) || 0) + (parseFloat(wrapCS.marginBottom) || 0);
    const overhead = chromeHeight + chromeMarginBottom + verticalPadding + wrapMargin + 24;
    const desiredWidth = Math.min(scale, 1) * containerWidth;
    const availableHeight = Math.max(containerHeight - overhead, 80);
    const maxWidthByHeight = availableHeight / svgAspect(svg);
    const width = Math.max(Math.min(desiredWidth, maxWidthByHeight), 60);
    el.style.width = `${width}px`;
  }

  // Total scroll-jacked distance, split across the two scenes. Kept short on
  // purpose so a small scroll (a wheel tick or two) already moves things.
  const OVERVIEW_VH = 180;
  const DATAFLOW_VH = 420;
  const TOTAL_VH = OVERVIEW_VH + DATAFLOW_VH;

  // Fraction of total scroll range given to the overview scene; data-flow
  // takes the rest, all the way to the end.
  const OVERVIEW_END = OVERVIEW_VH / TOTAL_VH;

  // Overview and Data Flow hand off at the same scale (HANDOFF_SCALE) so the
  // diagram doesn't visibly jump in size right when the scenes cross-fade —
  // Overview shrinks down to it on the way out, Data Flow grows up from it
  // on the way in. Overview's own rampIn still starts small (minScale) for
  // a dramatic entrance the first time the section comes into view.
  const HANDOFF_SCALE = 0.75;
  const SIMPLE_ZOOM = { rampIn: 0.35, rampOut: 0.35, minScale: 0.4, maxScale: 1.0, rampOutMinScale: HANDOFF_SCALE };
  // No rampOut here (unlike Overview): Data Flow is the last scene in the
  // pinned section, so there's no next diagram to hand off to at a matching
  // scale — shrinking it right before the section releases just reads as
  // "getting smaller for no reason" before normal, full-size page content
  // appears. It now holds at full size all the way to the end instead.
  const DATAFLOW_ZOOM = { rampIn: 0.1, rampOut: 0, minScale: HANDOFF_SCALE, maxScale: 1.0 };

  let ticking = false;

  // "Scroll to continue" hint: this pinned section can otherwise read as
  // the end of the page to a first-time visitor, since the viewport stops
  // moving while the diagram keeps changing in place. One shared element,
  // reused for BOTH scenes — its opacity is driven directly off each
  // scene's own local progress (no CSS transition fighting the per-frame
  // scroll updates, and no abrupt `hidden` snap once it reaches 0), fading
  // out exactly as that scene's own entrance zoom (its rampIn) settles.
  // Since local progress resets to ~0 the moment Data Flow becomes the
  // active scene, the hint naturally reappears right at the cross-fade and
  // fades again — reinforcing "a new scene started, keep scrolling" there
  // too, not just at the very top of the section.
  //
  // It never drops all the way to 0, though: Overview's hold phase (full
  // zoom, reading the diagram) is a long stretch of scroll input that
  // produces zero visible change on its own — with the hint fully gone
  // there too, that stretch reads as the page being frozen rather than
  // just paused. A faint resting opacity keeps a "still scrollable" cue
  // on screen through every phase, not just the entrance.
  const scrollHint = document.getElementById("scrollHint");
  const HINT_REST_OPACITY = 0.6;

  function updateScrollHint(local, rampIn) {
    if (!scrollHint) return;
    const fade = Math.max(1 - local / rampIn, 0);
    scrollHint.style.opacity = Math.max(fade, HINT_REST_OPACITY);
  }

  function setScene(name) {
    sceneOverview.classList.toggle("active", name === "overview");
    sceneDataflow.classList.toggle("active", name === "dataflow");
  }

  function scrollableDistance() {
    return Math.max(archScrolly.offsetHeight - archSticky.offsetHeight, 1);
  }

  function updateArch() {
    const rect = archScrolly.getBoundingClientRect();
    const progress = Math.min(Math.max(-rect.top / scrollableDistance(), 0), 1);

    if (progress < OVERVIEW_END) {
      setScene("overview");
      const local = progress / OVERVIEW_END;
      updateScrollHint(local, SIMPLE_ZOOM.rampIn);
      const { scale } = computeZoom(local, SIMPLE_ZOOM);
      applyZoomWidth(diagramOverview, svgOverview, chromeOverview, scale);
    } else {
      setScene("dataflow");
      const local = (progress - OVERVIEW_END) / (1 - OVERVIEW_END);
      updateScrollHint(local, DATAFLOW_ZOOM.rampIn);
      const { scale, holdProgress } = computeZoom(local, DATAFLOW_ZOOM);
      applyZoomWidth(diagramDataflow, svgDataflow, chromeDataflow, scale);
      const stage = Math.min(lastStage, Math.max(0, Math.round(holdProgress * lastStage)));
      if (stage !== currentStage) renderStage(stage);
    }
  }

  function scrollToProgress(progress) {
    const top = window.scrollY + archScrolly.getBoundingClientRect().top + progress * scrollableDistance();
    window.scrollTo({ top, behavior: "smooth" });
  }

  scrollToDataflowStage = function (stage) {
    const hold = 1 - DATAFLOW_ZOOM.rampIn - DATAFLOW_ZOOM.rampOut;
    const local = DATAFLOW_ZOOM.rampIn + (stage / lastStage) * hold;
    scrollToProgress(OVERVIEW_END + local * (1 - OVERVIEW_END));
  };

  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        updateArch();
        ticking = false;
      });
    },
    { passive: true }
  );

  archScrolly.style.height = `${TOTAL_VH}vh`;
  updateArch();
}

if (flowSvg) {
  // Stages 0-7 = client-request steps, stages 8-13 = packet flow steps —
  // both walk through their paths one at a time, the same way.
  const stages = [
    {
      stage: 0,
      type: "request",
      path: "path-r1",
      boxes: ["box-front", "box-gateway"],
      badge: "1 / 8",
      desc: "Front → Gateway · API 요청",
    },
    {
      stage: 1,
      type: "request",
      path: "path-r2",
      boxes: ["box-gateway", "box-auth"],
      badge: "2 / 8",
      desc: "Gateway → Auth · 사용자·그룹 조회",
    },
    {
      stage: 2,
      type: "request",
      path: "path-r3",
      boxes: ["box-gateway", "box-core"],
      badge: "3 / 8",
      desc: "Gateway → Core · 조회·제어",
    },
    {
      stage: 3,
      type: "request",
      path: "path-r4",
      boxes: ["box-gateway", "box-ruleengine"],
      badge: "4 / 8",
      desc: "Gateway → RuleEngine · Flow API",
    },
    {
      stage: 4,
      type: "request",
      path: "path-r5",
      boxes: ["box-gateway", "box-ai"],
      badge: "5 / 8",
      desc: "Gateway → AI · AI API",
    },
    {
      stage: 5,
      type: "request",
      path: "path-r6",
      boxes: ["box-ruleengine", "box-core"],
      badge: "6 / 8",
      desc: "RuleEngine → Core · 조회·제어",
    },
    {
      stage: 6,
      type: "request",
      path: "path-r7",
      boxes: ["box-ruleengine", "box-ai"],
      badge: "7 / 8",
      desc: "RuleEngine → AI · Flow 생성·조회",
    },
    {
      stage: 7,
      type: "request",
      path: "path-r8",
      boxes: ["box-ai", "box-core"],
      badge: "8 / 8",
      desc: "AI → Core · 공간 조회·제어",
    },
    {
      stage: 8,
      type: "packet",
      path: "path-p1",
      boxes: ["box-sensor", "box-mqtt"],
      badge: "1 / 6",
      desc: "Sensor / Device → MQTT Gateway · 센서 패킷 전송",
    },
    {
      stage: 9,
      type: "packet",
      path: "path-p2",
      boxes: ["box-mqtt", "box-core"],
      badge: "2 / 6",
      desc: "MQTT Gateway → Core · MQTT 수신과 패킷 전처리",
    },
    {
      stage: 10,
      type: "packet",
      path: "path-p3",
      boxes: ["box-core", "box-rabbitmq"],
      badge: "3 / 6",
      desc: "Core → RabbitMQ · Telemetry 발행",
    },
    {
      stage: 11,
      type: "packet",
      path: "path-p4",
      boxes: ["box-rabbitmq", "box-ruleengine"],
      badge: "4 / 6",
      desc: "RabbitMQ → RuleEngine · Telemetry 수신과 규칙 실행",
    },
    {
      stage: 12,
      type: "packet",
      path: "path-p5",
      boxes: ["box-ruleengine", "box-rabbitmq"],
      badge: "5 / 6",
      desc: "RuleEngine → RabbitMQ · 조건 충족 시 ALERT 발행",
    },
    {
      stage: 13,
      type: "packet",
      path: "path-p6",
      boxes: ["box-rabbitmq", "box-ai"],
      badge: "6 / 6",
      desc: "RabbitMQ → AI · ALERT 이벤트 수신",
    },
  ];

  const requestStages = stages.filter((s) => s.type === "request");
  const packetStages = stages.filter((s) => s.type === "packet");
  const firstPacketStage = packetStages[0].stage;
  lastStage = stages.length - 1;

  function firstStageMap(list) {
    const map = {};
    list.forEach(({ stage, boxes }) => {
      boxes.forEach((id) => {
        if (!(id in map)) map[id] = stage;
      });
    });
    return map;
  }
  const requestBoxFirstStage = firstStageMap(requestStages);
  const packetBoxFirstStage = firstStageMap(packetStages);

  const tabs = document.querySelectorAll(".flow-tab");
  const prevBtn = document.getElementById("flowPrev");
  const nextBtn = document.getElementById("flowNext");
  const dotsWrap = document.getElementById("flowDots");
  const badgeEl = document.getElementById("flowStepBadge");
  const descEl = document.getElementById("flowStepDesc");

  let dotsType = null;

  renderStage = function (stage) {
    currentStage = stage;
    const active = stages[stage];
    const isRequest = active.type === "request";

    flowSvg.setAttribute("data-mode", isRequest ? "request" : "packet");

    // Blue (request) layer — traveled stays lit, current is bold
    requestStages.forEach((s) => {
      const pathEl = document.getElementById(s.path);
      pathEl.classList.toggle("lit", isRequest && stage >= s.stage);
      pathEl.classList.toggle("current", isRequest && stage === s.stage);
    });
    Object.keys(requestBoxFirstStage).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("blue-lit", isRequest && stage >= requestBoxFirstStage[id]);
    });
    requestStages.forEach((s) => {
      s.boxes.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("current", isRequest && stage === s.stage);
      });
    });

    // Orange (packet) layer — traveled stays lit, current is bold
    packetStages.forEach((s) => {
      const pathEl = document.getElementById(s.path);
      pathEl.classList.toggle("lit", !isRequest && stage >= s.stage);
      pathEl.classList.toggle("current", !isRequest && stage === s.stage);
    });
    Object.keys(packetBoxFirstStage).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle("lit", !isRequest && stage >= packetBoxFirstStage[id]);
    });
    packetStages.forEach((s) => {
      s.boxes.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle("current", !isRequest && stage === s.stage);
      });
    });

    badgeEl.textContent = active.badge;
    badgeEl.style.color = isRequest ? "#bf5af2" : "";
    descEl.textContent = active.desc;

    tabs.forEach((t) => {
      const tabIsRequest = t.dataset.flowMode === "request";
      t.classList.toggle("active", tabIsRequest === isRequest);
    });

    prevBtn.disabled = stage === 0;
    nextBtn.disabled = stage === lastStage;

    // Rebuild the step dots only when switching between the two flow types.
    if (dotsType !== active.type) {
      dotsType = active.type;
      dotsWrap.innerHTML = "";
      (isRequest ? requestStages : packetStages).forEach((s) => {
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "flow-dot";
        dot.setAttribute("aria-label", s.badge);
        dot.addEventListener("click", () => scrollToDataflowStage(s.stage));
        dotsWrap.appendChild(dot);
      });
    }
    const firstStageOfType = (isRequest ? requestStages : packetStages)[0].stage;
    dotsWrap.querySelectorAll(".flow-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === stage - firstStageOfType);
    });
  };

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      scrollToDataflowStage(tab.dataset.flowMode === "request" ? 0 : firstPacketStage);
    });
  });

  prevBtn.addEventListener("click", () => {
    if (currentStage > 0) scrollToDataflowStage(currentStage - 1);
  });

  nextBtn.addEventListener("click", () => {
    if (currentStage < lastStage) scrollToDataflowStage(currentStage + 1);
  });

  renderStage(0);
}

// "동작 방식" (ai-library.html): each .flow-sticky-wrap pairs a pinned
// diagram with a column of feature items — as the reader scrolls past each
// item, highlight the diagram node(s) it belongs to so the pinned diagram
// visibly tracks what's being read. There are two independent wraps now
// (챗봇 대화 흐름 / RAG 추천 파이프라인, split because they're genuinely
// different request pipelines — see BookRagService vs. ChatController),
// so this runs per-wrap via data-flow-diagram/data-flow-items markers
// rather than hardcoded ids, keeping the two groups from cross-highlighting.
document.querySelectorAll(".flow-sticky-wrap").forEach((wrap) => {
  const flowDiagram = wrap.querySelector("[data-flow-diagram]");
  const flowItemsList = wrap.querySelector("[data-flow-items]");
  if (!flowDiagram || !flowItemsList) return;

  const flowItems = flowItemsList.querySelectorAll(".feature-item[data-stage]");

  function setActiveFlowStage(stage) {
    // A node/arrow can belong to more than one stage (e.g. the LLM call
    // box is shared by both the chatbot and MCP client stages), so
    // data-stage is a space-separated list rather than a single value.
    flowDiagram.querySelectorAll("[data-stage]").forEach((el) => {
      el.classList.toggle("stage-active", el.dataset.stage.split(" ").includes(stage));
    });
    // The text/screenshot side spotlights one item at a time — only ever
    // one exact match here, unlike the diagram nodes above.
    flowItems.forEach((item) => {
      item.classList.toggle("stage-active", item.dataset.stage === stage);
    });
  }

  const stageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) setActiveFlowStage(entry.target.dataset.stage);
      });
    },
    { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
  );

  flowItems.forEach((item) => stageObserver.observe(item));
  if (flowItems[0]) setActiveFlowStage(flowItems[0].dataset.stage);
});
