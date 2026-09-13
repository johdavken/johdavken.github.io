/* Station command bridge - the letterbox from Station into the application.
 *
 * THE PAIR
 *
 *   station-state-bridge.js    application -> Station    (one window in)
 *   station-command-bridge.js  Station -> application    (one letterbox out)
 *
 * They are two files on purpose. The state bridge's whole value is that it
 * is read-only, by construction and by name; folding a write path into it
 * would make that a matter of which functions you happened to call. This
 * module carries requests the other way and nothing else: no state, no
 * snapshots of its own, no persistence, no sync.
 *
 * THE TWO FACES
 *
 * Producer (app.js, once):  connect({ execute, capabilities }) -> { disconnect }
 * Consumer (Station):       dispatch(command, args), isAvailable(), capabilities()
 *
 * As with the state bridge, the producer's handle is the only thing that can
 * disconnect, and a second connect() throws rather than silently taking
 * over. Holding this module gives a consumer a way to ASK for a change and
 * no way to make one: with no producer connected, every request is answered
 * `unavailable`, which is what the standalone harness and demo mode see, and
 * what the production host sees until the application installs an executor.
 *
 * WHAT DISPATCH GUARANTEES
 *
 *   - it never throws: malformed input, a missing producer, a producer that
 *     throws or answers nonsense all become a failure VALUE with a code from
 *     the contract's vocabulary;
 *   - the producer only ever sees a request the contract has normalized, so
 *     argument validation lives in one place and runs before any state is
 *     touched;
 *   - what comes back is frozen, and a success result's snapshot must
 *     already be frozen (it is meant to be the state bridge's own), so no
 *     live application object can cross here by accident.
 *
 * In this phase nothing connects a producer. That is deliberate: the
 * contract and the transport exist so Station can be written against them,
 * and Station stays read-only until the executor is installed in app.js.
 */
(function (root, factory) {
  const contract = typeof require === "function"
    ? require("./station-command-contract.js")
    : (root && root.PolynStationCommandContract);
  const api = factory(contract);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.PolynStationCommandBridge = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (contract) {
  "use strict";

  const NONE = Object.freeze([]);

  function createBridge() {
    let producer = null;   // { execute, capabilities } or null

    function isAvailable() {
      return producer !== null;
    }

    /* The commands the connected producer declared, frozen; empty when
     * nothing is connected. Station reads this to decide what to offer. */
    function capabilities() {
      return producer ? producer.capabilities : NONE;
    }

    function dispatch(command, args) {
      if (!contract) return Object.freeze({ ok: false, code: "internal", message: "The command contract is not loaded." });
      if (!producer) {
        return contract.failure("unavailable", { message: "No application is connected to Station commands." });
      }
      const request = contract.normalizeArguments(command, args);
      if (!request.ok) return request;
      if (!producer.capabilities.includes(request.command)) {
        return contract.failure("unavailable", { message: `The application does not support "${request.command}".` });
      }

      let result;
      try {
        result = producer.execute(request.command, request.args);
      } catch (error) {
        // A producer bug must not reach Station as an exception, and must
        // not say more than it needs to about the application's insides.
        return contract.failure("internal");
      }
      if (!contract.isResult(result)) return contract.failure("internal");
      if (result.ok && result.snapshot && !Object.isFrozen(result.snapshot)) {
        // The snapshot is supposed to be the state bridge's own frozen
        // object. An unfrozen one is something else - possibly live state -
        // and does not cross.
        return contract.failure("internal");
      }
      return Object.isFrozen(result) ? result : Object.freeze(result);
    }

    /**
     * Register the application as the executor. Returns the ONLY handle that
     * can disconnect it. `capabilities` names the commands the executor
     * implements; a name outside the contract's vocabulary is a wiring
     * mistake and is refused at install time rather than discovered later.
     */
    function connect(source) {
      if (producer) {
        throw new Error("station-command-bridge: a producer is already connected; disconnect it first");
      }
      if (!contract) throw new Error("station-command-bridge: the command contract is not loaded");
      const execute = source && source.execute;
      if (typeof execute !== "function") {
        throw new TypeError("station-command-bridge: connect({ execute, capabilities }) requires an execute function");
      }
      const declared = source && Array.isArray(source.capabilities) ? source.capabilities : [];
      const unknown = declared.filter(name => !contract.COMMANDS.includes(name));
      if (unknown.length) {
        throw new TypeError(`station-command-bridge: unknown capability "${unknown[0]}"`);
      }
      producer = {
        execute,
        capabilities: Object.freeze([...new Set(declared)])
      };
      let active = true;
      return Object.freeze({
        disconnect() {
          if (!active) return false;
          active = false;
          producer = null;
          return true;
        },
        isActive() { return active; }
      });
    }

    return Object.freeze({ connect, dispatch, isAvailable, capabilities });
  }

  const shared = createBridge();

  return Object.freeze({
    connect: shared.connect,
    dispatch: shared.dispatch,
    isAvailable: shared.isAvailable,
    capabilities: shared.capabilities,
    // A fresh, isolated bridge for tests; production has one.
    create: createBridge
  });
});
