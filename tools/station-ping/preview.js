/* The board: four styles down, three intensities across, every cell the
 * real rundown markup under the chosen theme. */
(function () {
  const STYLES = [
    ["radar", "Radar", "one ring"],
    ["double", "Double ring", "two, staggered"],
    ["sonar", "Sonar", "ring + contact flash"],
    ["halo", "Halo", "the dot breathes"]
  ];
  const INTENSITIES = [["whisper", "WHISPER"], ["standard", "STANDARD"], ["insistent", "INSISTENT"]];

  const SCENES = {
    one: [
      { id: "A6", role: "outside", lane: 0, x: 0, late: true },
      { id: "C2", role: "core", lane: 0, x: 42 },
      { id: "E1", role: "inside", lane: 1, x: 58 }
    ],
    stack: [
      { id: "A3", role: "outside", lane: 0, x: 0, late: true },
      { id: "B3", role: "subskin-outside", lane: 1, x: 0, late: true },
      { id: "C2", role: "core", lane: 0, x: 42 },
      { id: "E1", role: "inside", lane: 1, x: 58 }
    ],
    crowd: [
      { id: "A3", role: "outside", lane: 0, x: 0, late: true },
      { id: "B3", role: "subskin-outside", lane: 1, x: 0, late: true },
      { id: "D4", role: "subskin-inside", lane: 2, x: 0, late: true },
      { id: "C2", role: "core", lane: 0, x: 42 },
      { id: "E1", role: "inside", lane: 1, x: 58 }
    ]
  };

  const board = document.getElementById("board");
  const controls = {
    theme: document.getElementById("theme"),
    colour: document.getElementById("colour"),
    scene: document.getElementById("scene"),
    scale: document.getElementById("scale"),
    hover: document.getElementById("hover"),
    hitbox: document.getElementById("hitbox"),
    motion: document.getElementById("motion")
  };

  function el(tag, className, attrs, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    for (const key in attrs || {}) node.setAttribute(key, attrs[key]);
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function marker(spec) {
    const button = el("button", "station-rundown__marker", {
      type: "button", "data-lane": String(spec.lane), "data-layer-role": spec.role, "data-hopper": spec.id,
      style: `--station-rundown-x:${spec.x}%`, "aria-label": spec.id
    });
    if (spec.late) button.classList.add("is-past", "is-late");
    button.appendChild(el("span", "station-rundown__stem", { "aria-hidden": "true" }));
    button.appendChild(el("span", "station-rundown__dot", { "aria-hidden": "true" }));
    const label = el("span", "station-rundown__label");
    label.appendChild(el("span", "station-rundown__id", null, spec.id));
    button.appendChild(label);
    return button;
  }

  function track(scene) {
    const root = el("div", "station-rundown", { "data-window": "6" });
    const now = el("div", "station-rundown__now");
    now.appendChild(el("span", "station-rundown__now-label", null, "Now"));
    now.appendChild(el("span", "station-rundown__now-clock", null, "7:24 PM"));
    root.appendChild(now);
    const t = el("div", "station-rundown__track");
    const ticks = el("div", "station-rundown__ticks", { "aria-hidden": "true" });
    for (let i = 1; i <= 12; i += 1) {
      const kind = i % 4 === 0 ? "hour" : i % 2 === 0 ? "major" : "minor";
      const tick = el("span", `station-rundown__tick is-${kind}`, { style: `--station-rundown-x:${(i / 12) * 100}%` });
      ticks.appendChild(tick);
      if (kind === "hour" && i < 12) ticks.appendChild(el("span", "station-rundown__tick-label", { style: `--station-rundown-x:${(i / 12) * 100}%` }, `${7 + i / 4}:24`));
    }
    t.appendChild(ticks);
    t.appendChild(el("div", "station-rundown__axis", { "aria-hidden": "true" }));
    t.appendChild(el("div", "station-rundown__now-line", { "aria-hidden": "true" }));
    const markers = el("div", "station-rundown__markers", { role: "list" });
    for (const spec of SCENES[scene]) markers.appendChild(marker(spec));
    t.appendChild(markers);
    root.appendChild(t);
    return root;
  }

  function build() {
    board.replaceChildren();
    board.appendChild(el("div", "board__head", null, ""));
    for (const [, name] of INTENSITIES) board.appendChild(el("div", "board__head", null, name));
    for (const [style, name, note] of STYLES) {
      const row = el("div", "board__row", null, name);
      row.appendChild(el("small", null, null, note));
      board.appendChild(row);
      for (const [intensity] of INTENSITIES) {
        const cell = el("div", "cell station-root station-theme-scope", {
          "data-theme": controls.theme.value, "data-style": style, "data-intensity": intensity, "data-colour": controls.colour.value
        });
        cell.classList.toggle("is-hover", controls.hover.checked);
        cell.classList.toggle("is-hitbox", controls.hitbox.checked);
        cell.appendChild(el("span", "cell__tag", null, `${style} / ${intensity}`));
        cell.appendChild(track(controls.scene.value));
        board.appendChild(cell);
      }
    }
    board.classList.toggle("is-still", !controls.motion.checked);
    board.style.setProperty("--board-scale", controls.scale.value);
  }

  for (const key in controls) controls[key].addEventListener("change", build);
  build();
})();
