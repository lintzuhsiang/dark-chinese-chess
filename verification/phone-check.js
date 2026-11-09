/* Test-only console procedure. Paste into a fresh, dedicated test tab's remote
 * console, then call await runPhoneVerification('model / OS / browser version').
 * It prepares games through normal UI actions and measures your real taps.
 * This file is never imported by the application or included in its build. */
window.runPhoneVerification = async function runPhoneVerification(device) {
  if (!document.querySelector('.start-button')) throw new Error('Use a fresh test tab at the entry screen.');
  const frame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
  const buttons = () => [...document.querySelectorAll('.board button')];
  const control = text => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
  const flip = position => ({ position });
  const move = (from, to) => ({ from, to });
  const opening = [flip(0), flip(1), flip(4), flip(5), move(0, 1), move(5, 4), move(1, 0)];
  const cycle = [move(4, 5), move(0, 1), move(5, 4), move(1, 0)];
  const quiet = count => Array.from({ length: count }, (_, index) => cycle[index % 4]);
  const activeLong = [...opening];
  for (let block = 0; block < 10; block++) activeLong.push(...quiet(52), flip(8 + block * 2), flip(9 + block * 2));
  const fixtures = [{ name: 'short', active: opening, rest: quiet(59) }, { name: 'long', active: activeLong, rest: quiet(60) }];
  const distribution = { GENERAL: 1, ADVISOR: 2, ELEPHANT: 2, CHARIOT: 2, HORSE: 2, CANNON: 2, SOLDIER: 5 };
  const ordered = ['RED', 'BLACK'].flatMap(color => Object.entries(distribution).flatMap(([rank, count]) =>
    Array.from({ length: count }, (_, index) => `${color}-${rank}-${index}`)));
  const remaining = [...ordered];
  const take = prefix => remaining.splice(remaining.findIndex(id => id.startsWith(prefix)), 1)[0];
  const fixed = new Map([[0, take('RED-HORSE')], [1, take('BLACK-SOLDIER')], [4, take('RED-SOLDIER')], [5, take('BLACK-HORSE')]]);
  const deck = Array.from({ length: 32 }, (_, position) => fixed.get(position) ?? remaining.shift());
  const samples = [];
  for (let index = 31; index > 0; index--) {
    const other = ordered.indexOf(deck[index]);
    samples.push((other + 0.5) / (index + 1));
    [ordered[index], ordered[other]] = [ordered[other], ordered[index]];
  }
  async function play(actions) {
    for (const action of actions) {
      if ('position' in action) buttons()[action.position].click();
      else {
        buttons()[action.from].click();
        await frame();
        buttons()[action.to].click();
      }
      await frame();
    }
  }
  function countIs(expected) {
    const reviewStatus = document.querySelector('.reviewing .game-status')?.textContent;
    if (!control(`棋譜 · ${expected}`) && !reviewStatus?.includes(`第 ${expected}/${expected} 手`)) {
      throw new Error(`Unexpected game state; expected ${expected} actions. Refresh the test tab to retry.`);
    }
  }
  function tap(button, instruction) {
    if (!button || button.disabled) throw new Error('Expected an enabled verification control.');
    console.info(instruction);
    window.phoneVerificationStage = instruction;
    return new Promise(resolve => {
      function activated(event) {
        if (!event.isTrusted) return;
        button.removeEventListener('click', activated, true);
        const started = performance.now();
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now() - started)));
      }
      button.addEventListener('click', activated, true);
    });
  }
  const median = values => [...values].sort((a, b) => a - b)[2];
  const report = { device, userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight },
    method: 'five trusted tap activations per operation; click capture → two animation frames', runs: [] };
  for (const fixture of fixtures) {
    let index = 0;
    const random = Math.random;
    try {
      Math.random = () => samples[index++] ?? 1 - Number.EPSILON;
      (document.querySelector('.start-button') ?? control('重新開始')).click();
      await frame();
    } finally { Math.random = random; }
    console.info(`Preparing ${fixture.name}: ${fixture.active.length} accepted actions. Please wait.`);
    await play(fixture.active);
    countIs(fixture.active.length);
    const actionMs = [], undoMs = [], reviewMs = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      buttons()[4].click();
      await frame();
      actionMs.push(await tap(buttons()[5], `${fixture.name} ${attempt}/5: tap the empty square 第 2 列，第 2 欄 (selected Horse is ready).`));
      countIs(fixture.active.length + 1);
      undoMs.push(await tap(control('悔棋'), `${fixture.name} ${attempt}/5: now tap 悔棋.`));
      countIs(fixture.active.length);
    }
    await play(fixture.rest);
    control('覆盤').click();
    await frame();
    for (let attempt = 1; attempt <= 5; attempt++) {
      reviewMs.push(await tap(document.querySelector('[aria-label="最終局面"]'), `${fixture.name} Review ${attempt}/5: tap 終局.`));
      countIs(fixture.active.length + fixture.rest.length);
      document.querySelector('[aria-label="回到開局"]').click();
      await frame();
    }
    control('結束覆盤').click();
    await frame();
    report.runs.push({ name: fixture.name, activeActions: fixture.active.length,
      completedActions: fixture.active.length + fixture.rest.length,
      actionMs, undoMs, reviewMs, medians: { action: median(actionMs), undo: median(undoMs), review: median(reviewMs) } });
  }
  window.phoneVerificationReport = report;
  window.phoneVerificationStage = 'complete';
  console.info('Verification finished. Copy phoneVerificationReport and record whether this was a physical device.', report);
  return report;
};
