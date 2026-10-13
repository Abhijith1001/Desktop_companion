// Animation state machine for the buddy. Pure logic, no Electron imports.
//
// Rules
//   • DRAGGING can interrupt anything and returns to the state it interrupted.
//   • REMINDER can interrupt anything except DRAGGING (it resumes after the drop).
//   • While REMINDER is active only DRAGGING, SPEAKING and the resolving states
//     (CELEBRATING, IDLE) are allowed, so ambient behaviour can't hide a reminder.
//   • CELEBRATING, SPEAKING and LOOKING_AROUND are timed and fall back to IDLE
//     (or REMINDER if a reminder is still showing).
//   • SLEEPING is only left by an explicit wake, a reminder or a drag.
const STATES = Object.freeze({
  IDLE: 'IDLE', WALKING: 'WALKING', RUNNING: 'RUNNING', SITTING: 'SITTING', SLEEPING: 'SLEEPING',
  LOOKING_AROUND: 'LOOKING_AROUND', CELEBRATING: 'CELEBRATING', REMINDER: 'REMINDER', SPEAKING: 'SPEAKING',
  DRAGGING: 'DRAGGING', ANGRY: 'ANGRY', FALLING: 'FALLING', IMPACT: 'IMPACT', DIZZY: 'DIZZY',
  RECOVERING: 'RECOVERING',
});

// CSS class used by the renderer for each state.
const CSS = {
  IDLE: 'idle', WALKING: 'walk', RUNNING: 'run', SITTING: 'sit', SLEEPING: 'sleep', LOOKING_AROUND: 'look',
  CELEBRATING: 'happy', REMINDER: 'alert', SPEAKING: 'speak', DRAGGING: 'drag', ANGRY: 'angry',
  FALLING: 'falling', IMPACT: 'impact', DIZZY: 'dizzy', RECOVERING: 'recovering',
};

const TIMED = {
  CELEBRATING: 2500, SPEAKING: 4000, LOOKING_AROUND: 3000,
  ANGRY: 1600, IMPACT: 350, DIZZY: 1100, RECOVERING: 500,
};
const AMBIENT = [STATES.IDLE, STATES.WALKING, STATES.SITTING, STATES.LOOKING_AROUND];

class AnimationController {
  constructor({ now = () => Date.now(), onChange = () => {} } = {}) {
    this.now = now;
    this.onChange = onChange;
    this.state = STATES.IDLE;
    this.resumeTo = null;     // state to return to after a drag
    this.reminderActive = false;
    this.until = null;        // expiry for timed states
  }

  canTransition(to) {
    const from = this.state;
    if (!STATES[to]) return false;
    if (to === from) return true;
    if (to === STATES.DRAGGING) return true;
    if (from === STATES.DRAGGING) return false;           // use drop() to leave a drag
    if (to === STATES.REMINDER) return true;
    if (this.reminderActive) return [STATES.SPEAKING, STATES.CELEBRATING, STATES.IDLE, STATES.RUNNING, STATES.ANGRY].includes(to);
    if (from === STATES.SLEEPING) return false;           // use wake()
    return true;
  }

  transition(to) {
    if (!this.canTransition(to)) return false;
    if (to === STATES.DRAGGING && this.state !== STATES.DRAGGING) this.resumeTo = this.state;
    if (to === STATES.REMINDER) this.reminderActive = true;
    this.until = TIMED[to] ? this.now() + TIMED[to] : null;
    const changed = this.state !== to;
    this.state = to;
    if (changed) this.onChange(to, CSS[to]);
    return true;
  }

  drop({ airborne = false } = {}) {
    if (this.state !== STATES.DRAGGING) return false;
    const back = this.reminderActive ? STATES.REMINDER : (this.resumeTo === STATES.SLEEPING ? STATES.SLEEPING : STATES.IDLE);
    this.state = STATES.IDLE; // leave drag, then enter target through the normal rules
    this.resumeTo = null;
    if (airborne) {
      this.transition(STATES.FALLING);
      return true;
    }
    if (back === STATES.SLEEPING) { this.state = STATES.SLEEPING; this.onChange(STATES.SLEEPING, CSS.SLEEPING); return true; }
    this.onChange(STATES.IDLE, CSS.IDLE);
    if (back !== STATES.IDLE) this.transition(back);
    return true;
  }

  wake() {
    if (this.state !== STATES.SLEEPING) return false;
    this.state = STATES.IDLE;
    this.onChange(STATES.IDLE, CSS.IDLE);
    return true;
  }

  sleep() {
    if (this.reminderActive || this.state === STATES.DRAGGING) return false;
    return this.transition(STATES.SLEEPING);
  }

  // Reminder resolved by the user (done → celebrate, otherwise back to idle).
  resolveReminder({ celebrate }) {
    this.reminderActive = false;
    return this.transition(celebrate ? STATES.CELEBRATING : STATES.IDLE);
  }

  // Ends expired timed states. Returns true when the state changed.
  tick() {
    if (this.until && this.now() >= this.until) {
      this.until = null;
      if (this.state === STATES.IMPACT) {
        this.transition(STATES.DIZZY);
        return true;
      }
      if (this.state === STATES.DIZZY) {
        this.transition(STATES.RECOVERING);
        return true;
      }
      this.state = this.reminderActive ? STATES.REMINDER : STATES.IDLE;
      this.onChange(this.state, CSS[this.state]);
      return true;
    }
    return false;
  }

  // Ambient behaviour picker used when nothing else is going on.
  pickAmbient(random = Math.random) {
    if (this.reminderActive || this.until || [STATES.SLEEPING, STATES.DRAGGING, STATES.RUNNING, STATES.ANGRY, STATES.FALLING, STATES.IMPACT, STATES.DIZZY, STATES.RECOVERING].includes(this.state)) return false;
    const r = random();
    const to = r < 0.45 ? STATES.WALKING : r < 0.7 ? STATES.IDLE : r < 0.85 ? STATES.SITTING : STATES.LOOKING_AROUND;
    return this.transition(to);
  }

  get css() { return CSS[this.state]; }
  get isMoving() { return this.state === STATES.WALKING || this.state === STATES.RUNNING; }
}

module.exports = { AnimationController, STATES, CSS, AMBIENT, TIMED };
