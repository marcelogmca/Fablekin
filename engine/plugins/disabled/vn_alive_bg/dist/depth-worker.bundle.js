(() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __typeError = (msg) => {
    throw TypeError(msg);
  };
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __copyProps = (to2, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to2, key) && key !== except)
          __defProp(to2, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to2;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    // If the importer is in node compatibility mode or this is not an ESM
    // file that has been converted to a CommonJS file using a Babel-
    // compatible transform (i.e. "__esModule" has not been set), then set
    // "default" to the CommonJS "module.exports" for node compatibility.
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);
  var __accessCheck = (obj, member, msg) => member.has(obj) || __typeError("Cannot " + msg);
  var __privateGet = (obj, member, getter) => (__accessCheck(obj, member, "read from private field"), getter ? getter.call(obj) : member.get(obj));
  var __privateAdd = (obj, member, value) => member.has(obj) ? __typeError("Cannot add the same private member more than once") : member instanceof WeakSet ? member.add(obj) : member.set(obj, value);
  var __privateSet = (obj, member, value, setter) => (__accessCheck(obj, member, "write to private field"), setter ? setter.call(obj, value) : member.set(obj, value), value);

  // engine/plugins/vn_alive_bg/vendor/js/transformers.web.min.js
  var tA = __toESM(__require("onnxruntime-web/webgpu"));
  var import_onnxruntime_common = __require("onnxruntime-common");
  var import_meta = {};
  var Sk = Object.defineProperty;
  var Os = (t6, e) => {
    for (var s in e) Sk(t6, s, { get: e[s], enumerable: true });
  };
  var $e = {};
  var Ye = {};
  var Cy = {};
  var Ok = "4.0.1";
  var Fc = typeof self < "u";
  var Is = !Ry($e);
  var Ly = !Ry(Ye);
  var Zi = Fc && "caches" in self;
  var Ik = typeof globalThis.Deno < "u";
  var TM = typeof globalThis.Bun < "u";
  var ta = Ik && Zi && !Is;
  var $y = typeof process < "u";
  var Fy = $y && process?.release?.name === "node" && !ta;
  var Rc = typeof window < "u" && typeof window.document < "u";
  var Dc = Fc && ["DedicatedWorkerGlobalScope", "ServiceWorkerGlobalScope", "SharedWorkerGlobalScope"].includes(self.constructor?.name);
  var zk = Rc || Dc || ta;
  var Tk = Fy || typeof navigator < "u" && "gpu" in navigator;
  var Ck = typeof navigator < "u" && "ml" in navigator;
  var Pk = typeof crypto < "u" && typeof crypto.getRandomValues == "function";
  var Nk = typeof chrome < "u" && typeof chrome.runtime < "u" && typeof chrome.runtime.id == "string";
  var Lk = typeof ServiceWorkerGlobalScope < "u" && Fc && self instanceof ServiceWorkerGlobalScope;
  var $k = () => {
    if (typeof navigator > "u") return false;
    let t6 = navigator.userAgent, s = (navigator.vendor || "").indexOf("Apple") > -1, r = !t6.match(/CriOS|FxiOS|EdgiOS|OPiOS|mercury|brave/i) && !t6.includes("Chrome") && !t6.includes("Android");
    return s && r;
  };
  var Fk = $k();
  var K = Object.freeze({ IS_BROWSER_ENV: Rc, IS_WEBWORKER_ENV: Dc, IS_WEB_ENV: zk, IS_SERVICE_WORKER_ENV: Lk, IS_DENO_WEB_RUNTIME: ta, IS_WEB_CACHE_AVAILABLE: Zi, IS_WEBGPU_AVAILABLE: Tk, IS_WEBNN_AVAILABLE: Ck, IS_SAFARI: Fk, IS_PROCESS_AVAILABLE: $y, IS_NODE_ENV: Fy, IS_FS_AVAILABLE: Is, IS_PATH_AVAILABLE: Ly, IS_CRYPTO_AVAILABLE: Pk, IS_CHROME_AVAILABLE: Nk });
  var qc = Is && Ly;
  var ea = "./";
  if (qc) {
    let t6 = Object(import_meta).url;
    t6 ? ea = Ye.dirname(Ye.dirname(Cy.fileURLToPath(t6))) : typeof __dirname < "u" && (ea = Ye.dirname(__dirname));
  }
  var Rk = qc ? Ye.join(ea, "/.cache/") : null;
  var Py = "/models/";
  var Dk = qc ? Ye.join(ea, Py) : Py;
  var qk = typeof globalThis.fetch == "function" ? globalThis.fetch.bind(globalThis) : void 0;
  var Ge = Object.freeze({ DEBUG: 10, INFO: 20, WARNING: 30, ERROR: 40, NONE: 50 });
  var Ny = Ge.WARNING;
  var J = { version: Ok, backends: { onnx: {} }, get logLevel() {
    return Ny;
  }, set logLevel(t6) {
    Ny = t6, J.backends.onnx?.setLogLevel?.(t6);
  }, allowRemoteModels: true, remoteHost: "https://huggingface.co/", remotePathTemplate: "{model}/resolve/{revision}/", allowLocalModels: !(Rc || Dc || ta), localModelPath: Dk, useFS: Is, useBrowserCache: Zi, useFSCache: Is, cacheDir: Rk, useCustomCache: false, customCache: null, useWasmCache: Zi || Is, cacheKey: "transformers-cache", experimental_useCrossOriginStorage: false, fetch: qk };
  function Ry(t6) {
    return Object.keys(t6).length === 0;
  }
  var xe = class {
    constructor() {
      let t6 = function(...e) {
        return t6._call(...e);
      };
      return Object.setPrototypeOf(t6, new.target.prototype);
    }
    _call(...t6) {
      throw Error("Must implement _call method in subclass");
    }
  };
  function _t(t6, e) {
    t6 && t6(e);
  }
  var ts = class extends xe {
    constructor(e, s) {
      super(), this.callback = e, this.files_loading = s;
    }
    _call(e) {
      if (e.status === "progress") {
        this.files_loading[e.file] = { loaded: e.loaded, total: e.total };
        let s = Object.values(this.files_loading).reduce((o, i) => o + i.loaded, 0), r = Object.values(this.files_loading).reduce((o, i) => o + i.total, 0), n = r > 0 ? s / r * 100 : 0;
        this.callback({ status: "progress_total", name: e.name, progress: n, loaded: s, total: r, files: structuredClone(this.files_loading) });
      }
      this.callback(e);
    }
  };
  function Dy(t6) {
    return Number.isInteger(t6) || typeof t6 == "bigint";
  }
  function jc(t6) {
    return t6 == null || t6 === -1;
  }
  function Bc(t6) {
    let e = [], s = t6;
    for (; Array.isArray(s); ) e.push(s.length), s = s[0];
    return e;
  }
  function Fe(...t6) {
    return Array.prototype.concat.apply([], t6);
  }
  function qy(...t6) {
    return t6.reduce((e, s) => e.flatMap((r) => s.map((n) => [r, n])));
  }
  function zs(t6, e) {
    return Math.abs((t6 + e) % (2 * e) - e);
  }
  function ve(t6, e) {
    return Object.assign({}, ...e.map((s) => {
      if (t6[s] !== void 0) return { [s]: t6[s] };
    }));
  }
  function jy(t6, e) {
    let s = 0;
    for (let r of t6) r === e && ++s;
    return s;
  }
  var F = { error(...t6) {
    J.logLevel <= Ge.ERROR && console.error(...t6);
  }, warn(...t6) {
    J.logLevel <= Ge.WARNING && console.warn(...t6);
  }, info(...t6) {
    J.logLevel <= Ge.INFO && console.log(...t6);
  }, debug(...t6) {
    J.logLevel <= Ge.DEBUG && console.log(...t6);
  }, log(...t6) {
    this.info(...t6);
  } };
  var jk = class {
    constructor(t6) {
      this.trie = this._build_trie(t6);
    }
    _build_trie(t6) {
      let e = /* @__PURE__ */ Object.create(null);
      for (let s of t6) {
        let r = e;
        for (let n = 0; n < s.length; ++n) {
          let o = s[n];
          r = r[o] ?? (r[o] = /* @__PURE__ */ Object.create(null));
        }
        r.end = s;
      }
      return e;
    }
    split(t6) {
      let e = [], s = t6.length, r = 0, n = 0;
      for (; n < s; ) {
        let o = this.trie, i = null, a = n;
        for (; a < s && (o = o[t6[a]]); ) o.end && (i = o.end), ++a;
        i ? (n > r && e.push(t6.slice(r, n)), e.push(i), n += i.length, r = n) : ++n;
      }
      return r < s && e.push(t6.slice(r)), e;
    }
  };
  var By = jk;
  var Bk = class {
    constructor(t6) {
      this.content = t6.content, this.id = t6.id, this.single_word = t6.single_word ?? false, this.lstrip = t6.lstrip ?? false, this.rstrip = t6.rstrip ?? false, this.special = t6.special ?? false, this.normalized = t6.normalized ?? !this.special;
    }
  };
  var Uk = Bk;
  var Xy = (() => {
    let t6 = [...Array.from({ length: 94 }, (n, o) => o + 33), ...Array.from({ length: 12 }, (n, o) => o + 161), ...Array.from({ length: 82 }, (n, o) => o + 174)], e = t6.slice(), s = 0;
    for (let n = 0; n < 256; ++n) t6.includes(n) || (t6.push(n), e.push(256 + s), s += 1);
    let r = e.map((n) => String.fromCharCode(n));
    return Object.fromEntries(t6.map((n, o) => [n, r[o]]));
  })();
  var Gk = (t6) => Object.fromEntries(Object.entries(t6).map(([e, s]) => [s, e]));
  var Wk = Gk(Xy);
  var Uy = ".,!?\u2026\u3002\uFF0C\u3001\u0964\u06D4\u060C";
  var Vk = /* @__PURE__ */ new Map([["(?i:'s|'t|'re|'ve|'m|'ll|'d)", "(?:'([sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD]))"], ["(?i:[sdmt]|ll|ve|re)", "(?:[sS]|[dD]|[mM]|[tT]|[lL][lL]|[vV][eE]|[rR][eE])"], ["[^\\r\\n\\p{L}\\p{N}]?+", "[^\\r\\n\\p{L}\\p{N}]?"], ["[^\\s\\p{L}\\p{N}]++", "[^\\s\\p{L}\\p{N}]+"], ["(?>\\p{Nd}{510})", "(?:\\p{Nd}{510})"], ["\\p{Nd}{3}+", "(?:\\p{Nd}{3})+"], ["\\G", ""], [` ?[^(\\s|[${Uy}])]+`, ` ?[^\\s${Uy}]+`]]);
  var sa = "\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E";
  var Gc = (t6) => t6.replace(/ \./g, ".").replace(/ \?/g, "?").replace(/ \!/g, "!").replace(/ ,/g, ",").replace(/ \' /g, "'").replace(/ n't/g, "n't").replace(/ 'm/g, "'m").replace(/ 's/g, "'s").replace(/ 've/g, "'ve").replace(/ 're/g, "'re");
  var ra = (t6, e = true) => {
    if (t6.Regex !== void 0) {
      let s = t6.Regex.replace(/\\([#&~])/g, "$1");
      s = s.replace(/\\A/g, "^").replace(/\\z/g, "$").replace(/\\Z/g, "(?=\\r?\\n?$)");
      for (let [r, n] of Vk) s = s.replaceAll(r, n);
      try {
        return new RegExp(s, "gu");
      } catch (r) {
        if (!(r instanceof SyntaxError) || !r.message.toLowerCase().includes("invalid property name")) throw r;
        let n = false, o = s.replace(/(\\[pP])\{([^}=]+)\}/g, (i, a, l) => {
          try {
            return new RegExp(`\\p{${l}}`, "u"), `${a}{${l}}`;
          } catch {
            return n = true, `${a}{Script=${l}}`;
          }
        });
        if (!n) throw r;
        try {
          return new RegExp(o, "gu");
        } catch {
          throw r;
        }
      }
    } else if (t6.String !== void 0) {
      let s = Hk(t6.String);
      return new RegExp(e ? s : `(${s})`, "gu");
    } else return console.warn("Unknown pattern type:", t6), null;
  };
  var Hk = (t6) => t6.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  var Kk = (t6, e, s) => {
    let r = [], n = 0;
    for (; n < t6.length; ) {
      if (r.push(t6[n]), (e.get(t6[n]) ?? s) !== s) {
        ++n;
        continue;
      }
      for (; ++n < t6.length && (e.get(t6[n]) ?? s) === s; ) e.get(r.at(-1)) !== s && (r[r.length - 1] += t6[n]);
    }
    return r;
  };
  var Xk = (t6) => t6 >= 19968 && t6 <= 40959 || t6 >= 13312 && t6 <= 19903 || t6 >= 131072 && t6 <= 173791 || t6 >= 173824 && t6 <= 177983 || t6 >= 177984 && t6 <= 178207 || t6 >= 178208 && t6 <= 183983 || t6 >= 63744 && t6 <= 64255 || t6 >= 194560 && t6 <= 195103;
  var Qk = (t6) => Number.isInteger(t6) || typeof t6 == "bigint";
  var Yk = (t6) => {
    let e = 0;
    for (let s of t6) ++e;
    return e;
  };
  var Jk = (t6) => Qy(t6.toLowerCase());
  var rt = (...t6) => Array.prototype.concat.apply([], t6);
  var Wc = (t6) => new Map(Object.entries(t6));
  var Zk = (t6, e) => {
    let s = [], r = 0;
    for (let n of t6.matchAll(e)) {
      let o = n[0];
      r < n.index && s.push(t6.slice(r, n.index)), o.length > 0 && s.push(o), r = n.index + o.length;
    }
    return r < t6.length && s.push(t6.slice(r)), s;
  };
  var Qy = (t6) => t6.replace(/\p{M}/gu, "");
  var Gy = (t6, e, s = []) => {
    if (!t6 || Array.isArray(t6) || typeof t6 != "object") return `${e} must be a valid object`;
    for (let r of s) if (!(r in t6)) return `${e} must contain a "${r}" property`;
    return null;
  };
  var e1 = (t6) => t6.match(/\S+/g) || [];
  var t1 = class {
    constructor() {
      let t6 = function(...e) {
        return t6._call(...e);
      };
      return Object.setPrototypeOf(t6, new.target.prototype);
    }
  };
  var Sr = t1;
  var s1 = class extends Sr {
    constructor(t6) {
      super(), this.config = t6;
    }
    _call(t6) {
      return this.normalize(t6);
    }
  };
  var yt = s1;
  var r1 = class extends yt {
    tokenize_chinese_chars(t6) {
      let e = [];
      for (let s = 0; s < t6.length; ++s) {
        let r = t6[s], n = r.charCodeAt(0);
        Xk(n) ? (e.push(" "), e.push(r), e.push(" ")) : e.push(r);
      }
      return e.join("");
    }
    strip_accents(t6) {
      return t6.normalize("NFD").replace(/\p{Mn}/gu, "");
    }
    is_control(t6) {
      switch (t6) {
        case "	":
        case `
`:
        case "\r":
          return false;
        default:
          return /^\p{Cc}|\p{Cf}|\p{Co}|\p{Cs}$/u.test(t6);
      }
    }
    clean_text(t6) {
      let e = [];
      for (let s of t6) {
        let r = s.charCodeAt(0);
        r === 0 || r === 65533 || this.is_control(s) || (/^\s$/.test(s) ? e.push(" ") : e.push(s));
      }
      return e.join("");
    }
    normalize(t6) {
      return this.config.clean_text && (t6 = this.clean_text(t6)), this.config.handle_chinese_chars && (t6 = this.tokenize_chinese_chars(t6)), this.config.lowercase ? (t6 = t6.toLowerCase(), this.config.strip_accents !== false && (t6 = this.strip_accents(t6))) : this.config.strip_accents && (t6 = this.strip_accents(t6)), t6;
    }
  };
  var n1 = r1;
  var o1 = class extends yt {
    constructor(t6) {
      super(t6), this.charsmap = t6.precompiled_charsmap ?? null;
    }
    normalize(t6) {
      return t6 = t6.replace(/[\u0001-\u0008\u000B\u000E-\u001F\u007F\u008F\u009F]/gm, ""), t6 = t6.replace(/[\u0009\u000A\u000C\u000D\u00A0\u1680\u2000-\u200F\u2028\u2029\u202F\u205F\u2581\u3000\uFEFF\uFFFD]/gm, " "), t6.includes("\uFF5E") ? t6 = t6.split("\uFF5E").map((s) => s.normalize("NFKC")).join("\uFF5E") : t6 = t6.normalize("NFKC"), t6;
    }
  };
  var i1 = o1;
  var a1 = class extends yt {
    constructor(t6) {
      super(t6), this.normalizers = (t6.normalizers ?? []).map((e) => Yy(e));
    }
    normalize(t6) {
      return this.normalizers.reduce((e, s) => s ? s.normalize(e) : e, t6);
    }
  };
  var l1 = a1;
  var c1 = class extends yt {
    normalize(t6) {
      let e = ra(this.config.pattern ?? {});
      return e === null ? t6 : t6.replaceAll(e, this.config.content ?? "");
    }
  };
  var p1 = c1;
  var u1 = class extends yt {
    constructor() {
      super(...arguments), this.form = "NFC";
    }
    normalize(t6) {
      return t6 = t6.normalize(this.form), t6;
    }
  };
  var na = u1;
  var _1 = class extends na {
    constructor() {
      super(...arguments), this.form = "NFC";
    }
  };
  var d1 = _1;
  var m1 = class extends na {
    constructor() {
      super(...arguments), this.form = "NFD";
    }
  };
  var f1 = m1;
  var h1 = class extends na {
    constructor() {
      super(...arguments), this.form = "NFKC";
    }
  };
  var g1 = h1;
  var x1 = class extends na {
    constructor() {
      super(...arguments), this.form = "NFKD";
    }
  };
  var w1 = x1;
  var y1 = class extends yt {
    normalize(t6) {
      return this.config.strip_left && this.config.strip_right ? t6 = t6.trim() : (this.config.strip_left && (t6 = t6.trimStart()), this.config.strip_right && (t6 = t6.trimEnd())), t6;
    }
  };
  var b1 = y1;
  var k1 = class extends yt {
    normalize(t6) {
      return Qy(t6);
    }
  };
  var v1 = k1;
  var E1 = class extends yt {
    normalize(t6) {
      return t6.toLowerCase();
    }
  };
  var A1 = E1;
  var M1 = class extends yt {
    normalize(t6) {
      return t6 = this.config.prepend + t6, t6;
    }
  };
  var S1 = M1;
  function O1(t6) {
    if (t6 === null) return null;
    switch (t6.type) {
      case "BertNormalizer":
        return new n1(t6);
      case "Precompiled":
        return new i1(t6);
      case "Sequence":
        return new l1(t6);
      case "Replace":
        return new p1(t6);
      case "NFC":
        return new d1(t6);
      case "NFD":
        return new f1(t6);
      case "NFKC":
        return new g1(t6);
      case "NFKD":
        return new w1(t6);
      case "Strip":
        return new b1(t6);
      case "StripAccents":
        return new v1(t6);
      case "Lowercase":
        return new A1(t6);
      case "Prepend":
        return new S1(t6);
      default:
        throw new Error(`Unknown Normalizer type: ${t6.type}`);
    }
  }
  var Yy = O1;
  var I1 = class extends Sr {
    pre_tokenize(t6, e) {
      return (Array.isArray(t6) ? t6.map((s) => this.pre_tokenize_text(s, e)) : this.pre_tokenize_text(t6, e)).flat();
    }
    _call(t6, e) {
      return this.pre_tokenize(t6, e);
    }
  };
  var nt = I1;
  var z1 = class extends nt {
    constructor(t6) {
      super(), this.config = t6, this.add_prefix_space = this.config.add_prefix_space ?? false, this.trim_offsets = this.config.trim_offsets ?? false, this.use_regex = this.config.use_regex ?? true, this.pattern = /'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+/gu, this.byte_encoder = Xy, this.text_encoder = new TextEncoder();
    }
    pre_tokenize_text(t6, e) {
      return this.add_prefix_space && !t6.startsWith(" ") && (t6 = " " + t6), (this.use_regex ? t6.match(this.pattern) || [] : [t6]).map((r) => Array.from(this.text_encoder.encode(r), (n) => this.byte_encoder[n]).join(""));
    }
  };
  var T1 = z1;
  var C1 = class extends nt {
    pre_tokenize_text(t6, e) {
      return t6.match(/\w+|[^\w\s]+/g) || [];
    }
  };
  var P1 = C1;
  var N1 = class extends nt {
    constructor(t6) {
      super(), this.replacement = t6.replacement ?? "\u2581", this.str_rep = t6.str_rep || this.replacement, this.prepend_scheme = t6.prepend_scheme ?? "always";
    }
    pre_tokenize_text(t6, e) {
      let { section_index: s = void 0 } = e ?? {}, r = t6.replaceAll(" ", this.str_rep);
      return !r.startsWith(this.replacement) && (this.prepend_scheme === "always" || this.prepend_scheme === "first" && s === 0) && (r = this.str_rep + r), [r];
    }
  };
  var L1 = N1;
  var $1 = class extends nt {
    constructor(t6) {
      super(), this.config = t6, this.pattern = ra(this.config.pattern ?? {}, this.config.invert ?? true);
    }
    pre_tokenize_text(t6) {
      return this.pattern === null ? [] : this.config.invert ? t6.match(this.pattern) || [] : this.config.behavior?.toLowerCase() === "removed" ? t6.split(this.pattern).filter((e) => e) : Zk(t6, this.pattern);
    }
  };
  var F1 = $1;
  var R1 = class extends nt {
    constructor(t6) {
      super(), this.config = t6, this.pattern = new RegExp(`[^${sa}]+|[${sa}]+`, "gu");
    }
    pre_tokenize_text(t6) {
      return t6.match(this.pattern) || [];
    }
  };
  var D1 = R1;
  var q1 = class extends nt {
    constructor(t6) {
      super(), this.config = t6;
      let e = `[^\\d]+|\\d${this.config.individual_digits ? "" : "+"}`;
      this.pattern = new RegExp(e, "gu");
    }
    pre_tokenize_text(t6) {
      return t6.match(this.pattern) || [];
    }
  };
  var j1 = q1;
  var B1 = class extends nt {
    constructor() {
      super(), this.pattern = new RegExp(`[^\\s${sa}]+|[${sa}]`, "gu");
    }
    pre_tokenize_text(t6, e) {
      return t6.trim().match(this.pattern) || [];
    }
  };
  var U1 = B1;
  var G1 = class extends nt {
    constructor(t6) {
      super(), this.config = t6, this.pattern = ra(this.config.pattern ?? {}), this.content = this.config.content ?? "";
    }
    pre_tokenize_text(t6) {
      return this.pattern === null ? [t6] : [t6.replaceAll(this.pattern, this.config.content ?? "")];
    }
  };
  var W1 = G1;
  var V1 = class extends nt {
    constructor(t6) {
      super(), this.tokenizers = (t6.pretokenizers ?? []).map((e) => Jy(e));
    }
    pre_tokenize_text(t6, e) {
      return this.tokenizers.reduce((s, r) => r ? r.pre_tokenize(s, e) : s, [t6]);
    }
  };
  var H1 = V1;
  var K1 = class extends nt {
    pre_tokenize_text(t6) {
      return e1(t6);
    }
  };
  var X1 = K1;
  var Q1 = class extends nt {
    constructor(t6) {
      super(), this.config = t6, this._length = t6.length;
    }
    pre_tokenize_text(t6) {
      let e = [];
      for (let s = 0; s < t6.length; s += this._length) e.push(t6.slice(s, s + this._length));
      return e;
    }
  };
  var Y1 = Q1;
  function J1(t6) {
    if (t6 === null) return null;
    switch (t6.type) {
      case "BertPreTokenizer":
        return new U1();
      case "Sequence":
        return new H1(t6);
      case "Whitespace":
        return new P1();
      case "WhitespaceSplit":
        return new X1();
      case "Metaspace":
        return new L1(t6);
      case "ByteLevel":
        return new T1(t6);
      case "Split":
        return new F1(t6);
      case "Punctuation":
        return new D1(t6);
      case "Digits":
        return new j1(t6);
      case "Replace":
        return new W1(t6);
      case "FixedLength":
        return new Y1(t6);
      default:
        throw new Error(`Unknown PreTokenizer type: ${t6.type}`);
    }
  }
  var Jy = J1;
  var Z1 = class extends Sr {
    constructor(t6) {
      super(), this.config = t6, this.vocab = [], this.tokens_to_ids = /* @__PURE__ */ new Map(), this.unk_token_id = void 0, this.unk_token = void 0, this.end_of_word_suffix = void 0, this.fuse_unk = this.config.fuse_unk ?? false;
    }
    _call(t6) {
      let e = this.encode(t6);
      return this.fuse_unk && (e = Kk(e, this.tokens_to_ids, this.unk_token_id)), e;
    }
  };
  var oa = Z1;
  var ev = class extends oa {
    constructor(t6) {
      super(t6), this.max_input_chars_per_word = 100, this.tokens_to_ids = Wc(t6.vocab), this.unk_token_id = this.tokens_to_ids.get(t6.unk_token), this.unk_token = t6.unk_token, this.max_input_chars_per_word = t6.max_input_chars_per_word ?? 100, this.vocab = new Array(this.tokens_to_ids.size);
      for (let [e, s] of this.tokens_to_ids) this.vocab[s] = e;
    }
    encode(t6) {
      let e = [];
      for (let s of t6) {
        let r = [...s];
        if (r.length > this.max_input_chars_per_word) {
          e.push(this.unk_token);
          continue;
        }
        let n = false, o = 0, i = [];
        for (; o < r.length; ) {
          let a = r.length, l = null;
          for (; o < a; ) {
            let c = r.slice(o, a).join("");
            if (o > 0 && (c = this.config.continuing_subword_prefix + c), this.tokens_to_ids.has(c)) {
              l = c;
              break;
            }
            --a;
          }
          if (l === null) {
            n = true;
            break;
          }
          i.push(l), o = a;
        }
        n ? e.push(this.unk_token) : e.push(...i);
      }
      return e;
    }
  };
  var Wy = ev;
  var Vy = class Zy {
    constructor(e, s) {
      this.is_leaf = e, this.children = s;
    }
    static default() {
      return new Zy(false, /* @__PURE__ */ new Map());
    }
  };
  var tv = class {
    constructor() {
      this.root = Vy.default();
    }
    extend(t6) {
      for (let e of t6) this.push(e);
    }
    push(t6) {
      let e = this.root;
      for (let s of t6) {
        let r = e.children.get(s);
        r === void 0 && (r = Vy.default(), e.children.set(s, r)), e = r;
      }
      e.is_leaf = true;
    }
    *common_prefix_search(t6) {
      let e = this.root;
      if (e === void 0) return;
      let s = "";
      for (let r of t6) {
        if (s += r, e = e.children.get(r), e === void 0) return;
        e.is_leaf && (yield s);
      }
    }
  };
  var sv = tv;
  var Uc = class e0 {
    constructor(e, s, r, n, o) {
      this.token_id = e, this.node_id = s, this.pos = r, this.length = n, this.score = o, this.prev = null, this.backtrace_score = 0;
    }
    clone() {
      let e = new e0(this.token_id, this.node_id, this.pos, this.length, this.score);
      return e.prev = this.prev, e.backtrace_score = this.backtrace_score, e;
    }
  };
  var rv = class {
    constructor(t6, e, s) {
      this.chars = Array.from(t6), this.len = this.chars.length, this.bos_token_id = e, this.eos_token_id = s, this.nodes = [], this.begin_nodes = Array.from({ length: this.len + 1 }, () => []), this.end_nodes = Array.from({ length: this.len + 1 }, () => []);
      let r = new Uc(this.bos_token_id ?? 0, 0, 0, 0, 0), n = new Uc(this.eos_token_id ?? 0, 1, this.len, 0, 0);
      this.nodes.push(r.clone()), this.nodes.push(n.clone()), this.begin_nodes[this.len].push(n), this.end_nodes[0].push(r);
    }
    insert(t6, e, s, r) {
      let n = this.nodes.length, o = new Uc(r, n, t6, e, s);
      this.begin_nodes[t6].push(o), this.end_nodes[t6 + e].push(o), this.nodes.push(o);
    }
    viterbi() {
      let t6 = this.len, e = 0;
      for (; e <= t6; ) {
        if (this.begin_nodes[e].length == 0) return [];
        for (let i of this.begin_nodes[e]) {
          i.prev = null;
          let a = 0, l = null;
          for (let c of this.end_nodes[e]) {
            let p = c.backtrace_score + i.score;
            (l === null || p > a) && (l = c.clone(), a = p);
          }
          if (l !== null) i.prev = l, i.backtrace_score = a;
          else return [];
        }
        ++e;
      }
      let s = [], n = this.begin_nodes[t6][0].prev;
      if (n === null) return [];
      let o = n.clone();
      for (; o.prev !== null; ) s.push(o.clone()), o = o.clone().prev.clone();
      return s.reverse(), s;
    }
    piece(t6) {
      return this.chars.slice(t6.pos, t6.pos + t6.length).join("");
    }
    tokens() {
      return this.viterbi().map((e) => this.piece(e));
    }
    token_ids() {
      return this.viterbi().map((e) => e.token_id);
    }
  };
  var nv = rv;
  function ov(t6) {
    if (t6.length === 0) throw new Error("Array must not be empty");
    let e = t6[0], s = 0;
    for (let r = 1; r < t6.length; ++r) t6[r] < e && (e = t6[r], s = r);
    return [e, s];
  }
  var iv = class extends oa {
    constructor(t6, e) {
      super(t6);
      let s = t6.vocab.length;
      this.vocab = new Array(s), this.scores = new Array(s);
      for (let r = 0; r < s; ++r) [this.vocab[r], this.scores[r]] = t6.vocab[r];
      this.unk_token_id = t6.unk_id, this.unk_token = this.vocab[t6.unk_id], this.tokens_to_ids = new Map(this.vocab.map((r, n) => [r, n])), this.bos_token = " ", this.bos_token_id = this.tokens_to_ids.get(this.bos_token), this.eos_token = e, this.eos_token_id = this.tokens_to_ids.get(this.eos_token), this.unk_token = this.vocab[this.unk_token_id], this.min_score = ov(this.scores)[0], this.unk_score = this.min_score - 10, this.scores[this.unk_token_id] = this.unk_score, this.trie = new sv(), this.trie.extend(this.vocab), this.fuse_unk = true;
    }
    populate_nodes(t6) {
      let e = t6.chars, s = 1, r = 0;
      for (; r < e.length; ) {
        let n = false, o = [], i = e.slice(r).join(""), a = this.trie.common_prefix_search(i);
        for (let l of a) {
          o.push(l);
          let c = this.tokens_to_ids.get(l), p = this.scores[c], u = Yk(l);
          t6.insert(r, u, p, c), !n && u === s && (n = true);
        }
        n || t6.insert(r, s, this.unk_score, this.unk_token_id), r += s;
      }
    }
    tokenize(t6) {
      let e = new nv(t6, this.bos_token_id, this.eos_token_id);
      return this.populate_nodes(e), e.tokens();
    }
    encode(t6) {
      let e = [];
      for (let s of t6) {
        let r = this.tokenize(s);
        e.push(...r);
      }
      return e;
    }
  };
  var Hy = iv;
  var av = class {
    constructor(t6 = (s, r) => s > r, e = 1 / 0) {
      this._heap = [], this._comparator = t6, this._max_size = e;
    }
    get size() {
      return this._heap.length;
    }
    is_empty() {
      return this.size === 0;
    }
    peek() {
      return this._heap[0];
    }
    push(...t6) {
      return this.extend(t6);
    }
    extend(t6) {
      for (let e of t6) if (this.size < this._max_size) this._heap.push(e), this._sift_up();
      else {
        let s = this._smallest();
        this._comparator(e, this._heap[s]) && (this._heap[s] = e, this._sift_up_from(s));
      }
      return this.size;
    }
    pop() {
      let t6 = this.peek(), e = this.size - 1;
      return e > 0 && this._swap(0, e), this._heap.pop(), this._sift_down(), t6;
    }
    replace(t6) {
      let e = this.peek();
      return this._heap[0] = t6, this._sift_down(), e;
    }
    _parent(t6) {
      return (t6 + 1 >>> 1) - 1;
    }
    _left(t6) {
      return (t6 << 1) + 1;
    }
    _right(t6) {
      return t6 + 1 << 1;
    }
    _greater(t6, e) {
      return this._comparator(this._heap[t6], this._heap[e]);
    }
    _swap(t6, e) {
      let s = this._heap[t6];
      this._heap[t6] = this._heap[e], this._heap[e] = s;
    }
    _sift_up() {
      this._sift_up_from(this.size - 1);
    }
    _sift_up_from(t6) {
      for (; t6 > 0 && this._greater(t6, this._parent(t6)); ) this._swap(t6, this._parent(t6)), t6 = this._parent(t6);
    }
    _sift_down() {
      let t6 = 0;
      for (; this._left(t6) < this.size && this._greater(this._left(t6), t6) || this._right(t6) < this.size && this._greater(this._right(t6), t6); ) {
        let e = this._right(t6) < this.size && this._greater(this._right(t6), this._left(t6)) ? this._right(t6) : this._left(t6);
        this._swap(t6, e), t6 = e;
      }
    }
    _smallest() {
      return 2 ** Math.floor(Math.log2(this.size)) - 1;
    }
  };
  var lv = av;
  var cv = class {
    constructor(t6) {
      this.capacity = t6, this.cache = /* @__PURE__ */ new Map();
    }
    get(t6) {
      if (!this.cache.has(t6)) return;
      let e = this.cache.get(t6);
      return this.cache.delete(t6), this.cache.set(t6, e), e;
    }
    put(t6, e) {
      this.cache.has(t6) && this.cache.delete(t6), this.cache.set(t6, e), this.cache.size > this.capacity && this.cache.delete(this.cache.keys().next().value);
    }
    clear() {
      this.cache.clear();
    }
  };
  var pv = cv;
  var uv = class extends oa {
    constructor(t6) {
      super(t6), this.tokens_to_ids = Wc(t6.vocab), this.unk_token_id = this.tokens_to_ids.get(t6.unk_token), this.unk_token = t6.unk_token, this.vocab = new Array(this.tokens_to_ids.size);
      for (let [s, r] of this.tokens_to_ids) this.vocab[r] = s;
      let e = Array.isArray(t6.merges[0]);
      this.merges = e ? t6.merges : t6.merges.map((s) => s.split(" ", 2)), this.bpe_ranks = new Map(this.merges.map((s, r) => [JSON.stringify(s), r])), this.end_of_word_suffix = t6.end_of_word_suffix, this.continuing_subword_suffix = t6.continuing_subword_suffix ?? null, this.byte_fallback = this.config.byte_fallback ?? false, this.byte_fallback && (this.text_encoder = new TextEncoder()), this.ignore_merges = this.config.ignore_merges ?? false, this.max_length_to_cache = 256, this.cache_capacity = 1e4, this.cache = new pv(this.cache_capacity);
    }
    clear_cache() {
      this.cache.clear();
    }
    bpe(t6) {
      if (t6.length === 0) return [];
      let e = this.cache.get(t6);
      if (e !== void 0) return e;
      let s = Array.from(t6);
      this.end_of_word_suffix && (s[s.length - 1] += this.end_of_word_suffix);
      let r = [];
      if (s.length > 1) {
        let n = new lv((a, l) => a.score < l.score), o = { token: s[0], bias: 0, prev: null, next: null }, i = o;
        for (let a = 1; a < s.length; ++a) {
          let l = { bias: a / s.length, token: s[a], prev: i, next: null };
          i.next = l, this.add_node(n, i), i = l;
        }
        for (; !n.is_empty(); ) {
          let a = n.pop();
          if (a.deleted || !a.next || a.next.deleted) continue;
          if (a.deleted = true, a.next.deleted = true, a.prev) {
            let c = { ...a.prev };
            a.prev.deleted = true, a.prev = c, c.prev ? c.prev.next = c : o = c;
          }
          let l = { token: a.token + a.next.token, bias: a.bias, prev: a.prev, next: a.next.next };
          l.prev ? (l.prev.next = l, this.add_node(n, l.prev)) : o = l, l.next && (l.next.prev = l, this.add_node(n, l));
        }
        for (let a = o; a !== null; a = a.next) r.push(a.token);
      } else r = s;
      if (this.continuing_subword_suffix) for (let n = 0; n < r.length - 1; ++n) r[n] += this.continuing_subword_suffix;
      return t6.length < this.max_length_to_cache && this.cache.put(t6, r), r;
    }
    add_node(t6, e) {
      let s = this.bpe_ranks.get(JSON.stringify([e.token, e.next.token]));
      s !== void 0 && (e.score = s + e.bias, t6.push(e));
    }
    encode(t6) {
      let e = [];
      for (let s of t6) {
        if (this.ignore_merges && this.tokens_to_ids.has(s)) {
          e.push(s);
          continue;
        }
        let r = this.bpe(s);
        for (let n of r) if (this.tokens_to_ids.has(n)) e.push(n);
        else if (this.byte_fallback) {
          let o = Array.from(this.text_encoder.encode(n)).map((i) => `<0x${i.toString(16).toUpperCase().padStart(2, "0")}>`);
          o.every((i) => this.tokens_to_ids.has(i)) ? e.push(...o) : this.unk_token != null && e.push(this.unk_token);
        } else this.unk_token != null && e.push(this.unk_token);
      }
      return e;
    }
  };
  var Ky = uv;
  var _v = class extends oa {
    constructor(t6, e) {
      super(t6);
      let s = t6.vocab;
      this.tokens_to_ids = Wc(e.target_lang ? s[e.target_lang] : s), this.bos_token = e.bos_token, this.bos_token_id = this.tokens_to_ids.get(this.bos_token), this.eos_token = e.eos_token, this.eos_token_id = this.tokens_to_ids.get(this.eos_token), this.pad_token = e.pad_token, this.pad_token_id = this.tokens_to_ids.get(this.pad_token), this.unk_token = e.unk_token, this.unk_token_id = this.tokens_to_ids.get(this.unk_token), this.vocab = new Array(this.tokens_to_ids.size);
      for (let [r, n] of this.tokens_to_ids) this.vocab[n] = r;
    }
    encode(t6) {
      return t6;
    }
  };
  var dv = _v;
  function mv(t6, e) {
    switch (t6.type) {
      case "WordPiece":
        return new Wy(t6);
      case "Unigram":
        return new Hy(t6, e.eos_token);
      case "BPE":
        return new Ky(t6);
      default:
        if (t6.vocab) return Array.isArray(t6.vocab) ? new Hy(t6, e.eos_token) : Object.hasOwn(t6, "continuing_subword_prefix") && Object.hasOwn(t6, "unk_token") ? Object.hasOwn(t6, "merges") ? new Ky(t6) : new Wy(t6) : new dv(t6, { target_lang: e.target_lang, bos_token: e.bos_token, eos_token: e.eos_token, pad_token: e.pad_token, unk_token: e.unk_token });
        throw new Error(`Unknown TokenizerModel type: ${t6?.type}`);
    }
  }
  var fv = mv;
  var hv = class extends Sr {
    constructor(t6) {
      super(), this.config = t6;
    }
    _call(t6, ...e) {
      return this.post_process(t6, ...e);
    }
  };
  var Or = hv;
  var gv = class extends Or {
    post_process(t6, e = null, s = true) {
      let r = e === null ? this.config.single : this.config.pair, n = [], o = [];
      for (let i of r) "SpecialToken" in i ? s && (n.push(i.SpecialToken.id), o.push(i.SpecialToken.type_id)) : "Sequence" in i && (i.Sequence.id === "A" ? (n = rt(n, t6), o = rt(o, new Array(t6.length).fill(i.Sequence.type_id))) : i.Sequence.id === "B" && (n = rt(n, e), o = rt(o, new Array(e.length).fill(i.Sequence.type_id))));
      return { tokens: n, token_type_ids: o };
    }
  };
  var xv = gv;
  var wv = class extends Or {
    post_process(t6, e = null) {
      return { tokens: t6, tokens_pair: e };
    }
  };
  var yv = wv;
  var bv = class extends Or {
    constructor(t6) {
      super(t6), this.sep = t6.sep, this.cls = t6.cls;
    }
    post_process(t6, e = null, s = true) {
      s && (t6 = rt([this.cls[0]], t6, [this.sep[0]]));
      let r = new Array(t6.length).fill(0);
      if (e) {
        let n = [], o = s ? [this.sep[0]] : [];
        t6 = rt(t6, n, e, o), r = rt(r, new Array(e.length + n.length + o.length).fill(1));
      }
      return { tokens: t6, token_type_ids: r };
    }
  };
  var kv = bv;
  var vv = class extends Or {
    constructor(t6) {
      super(t6), this.sep = t6.sep, this.cls = t6.cls;
    }
    post_process(t6, e, s = true) {
      s && (t6 = rt([this.cls[0]], t6, [this.sep[0]]));
      let r = new Array(t6.length).fill(0);
      if (e) {
        let n = s ? [this.sep[0]] : [], o = s ? [this.sep[0]] : [];
        t6 = rt(t6, n, e, o), r = rt(r, new Array(e.length + n.length + o.length).fill(1));
      }
      return { tokens: t6, token_type_ids: r };
    }
  };
  var Ev = vv;
  var Av = class extends Or {
    constructor(t6) {
      super(t6), this.processors = (t6.processors ?? []).map((e) => t0(e));
    }
    post_process(t6, e = null, s = true) {
      let r = { tokens: t6, tokens_pair: e };
      for (let n of this.processors) r = n.post_process(r.tokens, r.tokens_pair, s);
      return r;
    }
  };
  var Mv = Av;
  function Sv(t6) {
    if (t6 === null) return null;
    switch (t6.type) {
      case "TemplateProcessing":
        return new xv(t6);
      case "ByteLevel":
        return new yv(t6);
      case "BertProcessing":
        return new kv(t6);
      case "RobertaProcessing":
        return new Ev(t6);
      case "Sequence":
        return new Mv(t6);
      default:
        throw new Error(`Unknown PostProcessor type: ${t6.type}`);
    }
  }
  var t0 = Sv;
  var Ov = class extends Sr {
    constructor(t6) {
      super(), this.config = t6, this.added_tokens = [], this.end_of_word_suffix = null, this.trim_offsets = "trim_offsets" in t6 ? t6.trim_offsets : false;
    }
    _call(t6) {
      return this.decode(t6);
    }
    decode(t6) {
      return this.decode_chain(t6).join("");
    }
  };
  var Je = Ov;
  var Iv = class extends Je {
    constructor(t6) {
      super(t6), this.byte_decoder = Wk, this.text_decoder = new TextDecoder("utf-8", { fatal: false, ignoreBOM: true }), this.end_of_word_suffix = null;
    }
    convert_tokens_to_string(t6) {
      let e = t6.join(""), s = new Uint8Array([...e].map((r) => this.byte_decoder[r]));
      return this.text_decoder.decode(s);
    }
    decode_chain(t6) {
      let e = [], s = [];
      for (let r of t6) this.added_tokens.find((n) => n.content === r) !== void 0 ? (s.length > 0 && (e.push(this.convert_tokens_to_string(s)), s = []), e.push(r)) : s.push(r);
      return s.length > 0 && e.push(this.convert_tokens_to_string(s)), e;
    }
  };
  var zv = Iv;
  var Tv = class extends Je {
    constructor(t6) {
      super(t6), this.cleanup = t6.cleanup;
    }
    decode_chain(t6) {
      return t6.map((e, s) => {
        if (s !== 0) {
          let r = this.config.prefix;
          r && e.startsWith(r) ? e = e.replace(r, "") : e = " " + e;
        }
        return this.cleanup && (e = Gc(e)), e;
      });
    }
  };
  var Cv = Tv;
  var Pv = class extends Je {
    constructor(t6) {
      super(t6), this.replacement = t6.replacement ?? "\u2581";
    }
    decode_chain(t6) {
      let e = [];
      for (let s = 0; s < t6.length; ++s) {
        let r = t6[s].replaceAll(this.replacement, " ");
        s == 0 && r.startsWith(" ") && (r = r.substring(1)), e.push(r);
      }
      return e;
    }
  };
  var Nv = Pv;
  var Lv = class extends Je {
    constructor(t6) {
      super(t6), this.suffix = t6.suffix ?? "";
    }
    decode_chain(t6) {
      return t6.map((e, s) => e.replaceAll(this.suffix, s === t6.length - 1 ? "" : " "));
    }
  };
  var $v = Lv;
  var Fv = class extends Je {
    constructor(t6) {
      super(t6), this.pad_token = t6.pad_token ?? "", this.word_delimiter_token = t6.word_delimiter_token ?? "", this.cleanup = t6.cleanup;
    }
    convert_tokens_to_string(t6) {
      if (t6.length === 0) return "";
      let e = [t6[0]];
      for (let n = 1; n < t6.length; ++n) t6[n] !== e.at(-1) && e.push(t6[n]);
      let r = e.filter((n) => n !== this.pad_token).join("");
      return this.cleanup && (r = Gc(r).replaceAll(this.word_delimiter_token, " ").trim()), r;
    }
    decode_chain(t6) {
      return [this.convert_tokens_to_string(t6)];
    }
  };
  var Rv = Fv;
  var Dv = class extends Je {
    constructor(t6) {
      super(t6), this.decoders = (t6.decoders ?? []).map((e) => s0(e));
    }
    decode_chain(t6) {
      return this.decoders.reduce((e, s) => s.decode_chain(e), t6);
    }
  };
  var qv = Dv;
  var jv = class extends Je {
    decode_chain(t6) {
      let e = ra(this.config.pattern), s = this.config.content ?? "";
      return e === null ? t6 : t6.map((r) => r.replaceAll(e, s));
    }
  };
  var Bv = jv;
  var Uv = class extends Je {
    decode_chain(t6) {
      return [t6.join("")];
    }
  };
  var Gv = Uv;
  var Wv = class extends Je {
    constructor(t6) {
      super(t6), this.content = t6.content ?? "", this.start = t6.start ?? 0, this.stop = t6.stop ?? 0;
    }
    decode_chain(t6) {
      return t6.map((e) => {
        let s = 0;
        for (let n = 0; n < this.start && e[n] === this.content; ++n) {
          s = n + 1;
          continue;
        }
        let r = e.length;
        for (let n = 0; n < this.stop; ++n) {
          let o = e.length - n - 1;
          if (e[o] === this.content) {
            r = o;
            continue;
          } else break;
        }
        return e.slice(s, r);
      });
    }
  };
  var Vv = Wv;
  var Hv = class extends Je {
    constructor(t6) {
      super(t6), this.text_decoder = new TextDecoder();
    }
    decode_chain(t6) {
      let e = [], s = [];
      for (let r of t6) {
        let n = null;
        if (r.length === 6 && r.startsWith("<0x") && r.endsWith(">")) {
          let o = parseInt(r.slice(3, 5), 16);
          isNaN(o) || (n = o);
        }
        if (n !== null) s.push(n);
        else {
          if (s.length > 0) {
            let o = this.text_decoder.decode(Uint8Array.from(s));
            e.push(o), s = [];
          }
          e.push(r);
        }
      }
      if (s.length > 0) {
        let r = this.text_decoder.decode(Uint8Array.from(s));
        e.push(r), s = [];
      }
      return e;
    }
  };
  var Kv = Hv;
  function Xv(t6) {
    if (t6 === null) return null;
    switch (t6.type) {
      case "ByteLevel":
        return new zv(t6);
      case "WordPiece":
        return new Cv(t6);
      case "Metaspace":
        return new Nv(t6);
      case "BPEDecoder":
        return new $v(t6);
      case "CTC":
        return new Rv(t6);
      case "Sequence":
        return new qv(t6);
      case "Replace":
        return new Bv(t6);
      case "Fuse":
        return new Gv(t6);
      case "Strip":
        return new Vv(t6);
      case "ByteFallback":
        return new Kv(t6);
      default:
        throw new Error(`Unknown Decoder type: ${t6.type}`);
    }
  }
  var s0 = Xv;
  var Qv = class {
    constructor(t6, e) {
      let s = Gy(t6, "Tokenizer", ["model", "decoder", "post_processor", "pre_tokenizer", "normalizer"]);
      if (s) throw new Error(s);
      let r = Gy(e, "Config");
      if (r) throw new Error(r);
      this.tokenizer = t6, this.config = e, this.normalizer = Yy(this.tokenizer.normalizer), this.pre_tokenizer = Jy(this.tokenizer.pre_tokenizer), this.model = fv(this.tokenizer.model, this.config), this.post_processor = t0(this.tokenizer.post_processor), this.decoder = s0(this.tokenizer.decoder), this.special_tokens = [], this.all_special_ids = [], this.added_tokens = [];
      let n = [], o = [];
      this.added_tokens_map = /* @__PURE__ */ new Map();
      for (let i of this.tokenizer.added_tokens) {
        let a = new Uk(i);
        if (this.added_tokens.push(a), this.model.tokens_to_ids.set(a.content, a.id), this.model.vocab[a.id] = a.content, a.special && (this.special_tokens.push(a.content), this.all_special_ids.push(a.id)), this.added_tokens_map.set(a.content, a), a.normalized && this.normalizer !== null) {
          let l = this.normalizer(a.content);
          o.push(l), this.added_tokens_map.set(l, a);
        } else n.push(a.content);
      }
      (this.config.additional_special_tokens ?? []).forEach((i) => {
        this.special_tokens.includes(i) || this.special_tokens.push(i);
      }), this.decoder && (this.decoder.added_tokens = this.added_tokens, this.decoder.end_of_word_suffix = this.model.end_of_word_suffix), this.splitter_unnormalized = new By(n), this.splitter_normalized = new By(o), this.remove_space = this.config.remove_space, this.clean_up_tokenization_spaces = this.config.clean_up_tokenization_spaces ?? true, this.do_lowercase_and_remove_accent = this.config.do_lowercase_and_remove_accent ?? false;
    }
    encode(t6, { text_pair: e = null, add_special_tokens: s = true, return_token_type_ids: r = null } = {}) {
      let { tokens: n, token_type_ids: o } = this.tokenize_helper(t6, { text_pair: e, add_special_tokens: s }), i = n.map((l) => this.added_tokens_map.get(l)?.id ?? this.model.tokens_to_ids.get(l) ?? this.model.unk_token_id), a = { ids: i, tokens: n, attention_mask: new Array(i.length).fill(1) };
      return r && o && (a.token_type_ids = o), a;
    }
    decode(t6, e = {}) {
      if (!Array.isArray(t6) || t6.length === 0 || !Qk(t6[0])) throw Error("token_ids must be a non-empty array of integers.");
      let s = t6.map((n) => this.model.vocab[Number(n)] ?? this.model.unk_token);
      e.skip_special_tokens && (s = s.filter((n) => !this.special_tokens.includes(n)));
      let r = this.decoder ? this.decoder(s) : s.join(" ");
      return this.decoder && this.decoder.end_of_word_suffix && (r = r.replaceAll(this.decoder.end_of_word_suffix, " "), e.skip_special_tokens && (r = r.trim())), (e.clean_up_tokenization_spaces ?? this.clean_up_tokenization_spaces) && (r = Gc(r)), r;
    }
    tokenize(t6, { text_pair: e = null, add_special_tokens: s = false } = {}) {
      return this.tokenize_helper(t6, { text_pair: e, add_special_tokens: s }).tokens;
    }
    encode_text(t6) {
      if (t6 === null) return null;
      let e = this.splitter_unnormalized.split(t6);
      return e.forEach((s, r) => {
        let n = this.added_tokens_map.get(s);
        n && (n.lstrip && r > 0 && (e[r - 1] = e[r - 1].trimEnd()), n.rstrip && r < e.length - 1 && (e[r + 1] = e[r + 1].trimStart()));
      }), e.flatMap((s, r) => {
        if (s.length === 0) return [];
        if (this.added_tokens_map.has(s)) return [s];
        if (this.remove_space === true && (s = s.trim().split(/\s+/).join(" ")), this.do_lowercase_and_remove_accent && (s = Jk(s)), this.normalizer !== null && (s = this.normalizer(s)), s.length === 0) return [];
        let n = this.splitter_normalized.split(s);
        return n.forEach((o, i) => {
          let a = this.added_tokens_map.get(o);
          a && (a.lstrip && i > 0 && (n[i - 1] = n[i - 1].trimEnd()), a.rstrip && i < n.length - 1 && (n[i + 1] = n[i + 1].trimStart()));
        }), n.flatMap((o) => {
          if (o.length === 0) return [];
          if (this.added_tokens_map.has(o)) return [o];
          let i = this.pre_tokenizer !== null ? this.pre_tokenizer(o, { section_index: r }) : [o];
          return this.model(i);
        });
      });
    }
    tokenize_helper(t6, { text_pair: e = null, add_special_tokens: s = true }) {
      let r = this.encode_text(t6), n = this.encode_text(e || null);
      return this.post_processor ? this.post_processor(r, n, s) : { tokens: rt(r ?? [], n ?? []) };
    }
    token_to_id(t6) {
      return this.model.tokens_to_ids.get(t6);
    }
    id_to_token(t6) {
      return this.model.vocab[t6];
    }
    get_added_tokens_decoder() {
      let t6 = /* @__PURE__ */ new Map();
      for (let e of this.added_tokens) t6.set(e.id, e);
      return t6;
    }
    get_vocab(t6 = true) {
      let e = /* @__PURE__ */ new Map();
      for (let s = 0; s < this.model.vocab.length; ++s) {
        let r = this.model.vocab[s];
        (t6 || !this.added_tokens_map.has(r)) && e.set(r, s);
      }
      return e;
    }
  };
  var r0 = Qv;
  var M = Object.freeze({ Text: "Text", NumericLiteral: "NumericLiteral", StringLiteral: "StringLiteral", Identifier: "Identifier", Equals: "Equals", OpenParen: "OpenParen", CloseParen: "CloseParen", OpenStatement: "OpenStatement", CloseStatement: "CloseStatement", OpenExpression: "OpenExpression", CloseExpression: "CloseExpression", OpenSquareBracket: "OpenSquareBracket", CloseSquareBracket: "CloseSquareBracket", OpenCurlyBracket: "OpenCurlyBracket", CloseCurlyBracket: "CloseCurlyBracket", Comma: "Comma", Dot: "Dot", Colon: "Colon", Pipe: "Pipe", CallOperator: "CallOperator", AdditiveBinaryOperator: "AdditiveBinaryOperator", MultiplicativeBinaryOperator: "MultiplicativeBinaryOperator", ComparisonBinaryOperator: "ComparisonBinaryOperator", UnaryOperator: "UnaryOperator", Comment: "Comment" });
  var Ze = class {
    constructor(t6, e) {
      this.value = t6, this.type = e;
    }
  };
  function n0(t6) {
    return /\w/.test(t6);
  }
  function Ir(t6) {
    return /[0-9]/.test(t6);
  }
  function o0(t6) {
    return /\s/.test(t6);
  }
  var Yv = [["{%", M.OpenStatement], ["%}", M.CloseStatement], ["{{", M.OpenExpression], ["}}", M.CloseExpression], ["(", M.OpenParen], [")", M.CloseParen], ["{", M.OpenCurlyBracket], ["}", M.CloseCurlyBracket], ["[", M.OpenSquareBracket], ["]", M.CloseSquareBracket], [",", M.Comma], [".", M.Dot], [":", M.Colon], ["|", M.Pipe], ["<=", M.ComparisonBinaryOperator], [">=", M.ComparisonBinaryOperator], ["==", M.ComparisonBinaryOperator], ["!=", M.ComparisonBinaryOperator], ["<", M.ComparisonBinaryOperator], [">", M.ComparisonBinaryOperator], ["+", M.AdditiveBinaryOperator], ["-", M.AdditiveBinaryOperator], ["~", M.AdditiveBinaryOperator], ["*", M.MultiplicativeBinaryOperator], ["/", M.MultiplicativeBinaryOperator], ["%", M.MultiplicativeBinaryOperator], ["=", M.Equals]];
  var Jv = /* @__PURE__ */ new Map([["n", `
`], ["t", "	"], ["r", "\r"], ["b", "\b"], ["f", "\f"], ["v", "\v"], ["'", "'"], ['"', '"'], ["\\", "\\"]]);
  function Zv(t6, e = {}) {
    return t6.endsWith(`
`) && (t6 = t6.slice(0, -1)), e.lstrip_blocks && (t6 = t6.replace(/^[ \t]*({[#%-])/gm, "$1")), e.trim_blocks && (t6 = t6.replace(/([#%-]})\n/g, "$1")), t6.replace(/{%\s*(end)?generation\s*%}/gs, "");
  }
  function eE(t6, e = {}) {
    let s = [], r = Zv(t6, e), n = 0, o = 0, i = (c) => {
      let p = "";
      for (; c(r[n]); ) {
        if (r[n] === "\\") {
          if (++n, n >= r.length) throw new SyntaxError("Unexpected end of input");
          let u = r[n++], _ = Jv.get(u);
          if (_ === void 0) throw new SyntaxError(`Unexpected escaped character: ${u}`);
          p += _;
          continue;
        }
        if (p += r[n++], n >= r.length) throw new SyntaxError("Unexpected end of input");
      }
      return p;
    }, a = () => {
      let c = s.at(-1);
      c && c.type === M.Text && (c.value = c.value.trimEnd(), c.value === "" && s.pop());
    }, l = () => {
      for (; n < r.length && o0(r[n]); ) ++n;
    };
    e: for (; n < r.length; ) {
      let c = s.at(-1)?.type;
      if (c === void 0 || c === M.CloseStatement || c === M.CloseExpression || c === M.Comment) {
        let u = "";
        for (; n < r.length && !(r[n] === "{" && (r[n + 1] === "%" || r[n + 1] === "{" || r[n + 1] === "#")); ) u += r[n++];
        if (u.length > 0) {
          s.push(new Ze(u, M.Text));
          continue;
        }
      }
      if (r[n] === "{" && r[n + 1] === "#") {
        n += 2;
        let u = r[n] === "-";
        u && ++n;
        let _ = "";
        for (; r[n] !== "#" || r[n + 1] !== "}"; ) {
          if (n + 2 >= r.length) throw new SyntaxError("Missing end of comment tag");
          _ += r[n++];
        }
        let d = _.endsWith("-");
        d && (_ = _.slice(0, -1)), u && a(), s.push(new Ze(_, M.Comment)), n += 2, d && l();
        continue;
      }
      if (r.slice(n, n + 3) === "{%-") {
        a(), s.push(new Ze("{%", M.OpenStatement)), n += 3;
        continue;
      }
      if (r.slice(n, n + 3) === "{{-") {
        a(), s.push(new Ze("{{", M.OpenExpression)), o = 0, n += 3;
        continue;
      }
      if (i(o0), r.slice(n, n + 3) === "-%}") {
        s.push(new Ze("%}", M.CloseStatement)), n += 3, l();
        continue;
      }
      if (r.slice(n, n + 3) === "-}}") {
        s.push(new Ze("}}", M.CloseExpression)), n += 3, l();
        continue;
      }
      let p = r[n];
      if (p === "-" || p === "+") {
        let u = s.at(-1)?.type;
        if (u === M.Text || u === void 0) throw new SyntaxError(`Unexpected character: ${p}`);
        switch (u) {
          case M.Identifier:
          case M.NumericLiteral:
          case M.StringLiteral:
          case M.CloseParen:
          case M.CloseSquareBracket:
            break;
          default: {
            ++n;
            let _ = i(Ir);
            s.push(new Ze(`${p}${_}`, _.length > 0 ? M.NumericLiteral : M.UnaryOperator));
            continue;
          }
        }
      }
      for (let [u, _] of Yv) {
        if (u === "}}" && o > 0) continue;
        if (r.slice(n, n + u.length) === u) {
          s.push(new Ze(u, _)), _ === M.OpenExpression ? o = 0 : _ === M.OpenCurlyBracket ? ++o : _ === M.CloseCurlyBracket && --o, n += u.length;
          continue e;
        }
      }
      if (p === "'" || p === '"') {
        ++n;
        let u = i((_) => _ !== p);
        s.push(new Ze(u, M.StringLiteral)), ++n;
        continue;
      }
      if (Ir(p)) {
        let u = i(Ir);
        if (r[n] === "." && Ir(r[n + 1])) {
          ++n;
          let _ = i(Ir);
          u = `${u}.${_}`;
        }
        s.push(new Ze(u, M.NumericLiteral));
        continue;
      }
      if (n0(p)) {
        let u = i(n0);
        s.push(new Ze(u, M.Identifier));
        continue;
      }
      throw new SyntaxError(`Unexpected character: ${p}`);
    }
    return s;
  }
  var it = class {
    constructor() {
      __publicField(this, "type", "Statement");
    }
  };
  var tE = class extends it {
    constructor(t6) {
      super();
      __publicField(this, "type", "Program");
      this.body = t6;
    }
  };
  var sE = class extends it {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "If");
      this.test = t6, this.body = e, this.alternate = s;
    }
  };
  var rE = class extends it {
    constructor(t6, e, s, r) {
      super();
      __publicField(this, "type", "For");
      this.loopvar = t6, this.iterable = e, this.body = s, this.defaultBlock = r;
    }
  };
  var nE = class extends it {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "Break");
    }
  };
  var oE = class extends it {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "Continue");
    }
  };
  var iE = class extends it {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "Set");
      this.assignee = t6, this.value = e, this.body = s;
    }
  };
  var aE = class extends it {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "Macro");
      this.name = t6, this.args = e, this.body = s;
    }
  };
  var lE = class extends it {
    constructor(t6) {
      super();
      __publicField(this, "type", "Comment");
      this.value = t6;
    }
  };
  var Ke = class extends it {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "Expression");
    }
  };
  var cE = class extends Ke {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "MemberExpression");
      this.object = t6, this.property = e, this.computed = s;
    }
  };
  var i0 = class extends Ke {
    constructor(t6, e) {
      super();
      __publicField(this, "type", "CallExpression");
      this.callee = t6, this.args = e;
    }
  };
  var Ts = class extends Ke {
    constructor(t6) {
      super();
      __publicField(this, "type", "Identifier");
      this.value = t6;
    }
  };
  var Cs = class extends Ke {
    constructor(t6) {
      super();
      __publicField(this, "type", "Literal");
      this.value = t6;
    }
  };
  var pE = class extends Cs {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "IntegerLiteral");
    }
  };
  var uE = class extends Cs {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "FloatLiteral");
    }
  };
  var a0 = class extends Cs {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "StringLiteral");
    }
  };
  var _E = class extends Cs {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "ArrayLiteral");
    }
  };
  var l0 = class extends Cs {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "TupleLiteral");
    }
  };
  var dE = class extends Cs {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "ObjectLiteral");
    }
  };
  var zr = class extends Ke {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "BinaryExpression");
      this.operator = t6, this.left = e, this.right = s;
    }
  };
  var mE = class extends Ke {
    constructor(t6, e) {
      super();
      __publicField(this, "type", "FilterExpression");
      this.operand = t6, this.filter = e;
    }
  };
  var fE = class extends it {
    constructor(t6, e) {
      super();
      __publicField(this, "type", "FilterStatement");
      this.filter = t6, this.body = e;
    }
  };
  var hE = class extends Ke {
    constructor(t6, e) {
      super();
      __publicField(this, "type", "SelectExpression");
      this.lhs = t6, this.test = e;
    }
  };
  var gE = class extends Ke {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "TestExpression");
      this.operand = t6, this.negate = e, this.test = s;
    }
  };
  var xE = class extends Ke {
    constructor(t6, e) {
      super();
      __publicField(this, "type", "UnaryExpression");
      this.operator = t6, this.argument = e;
    }
  };
  var wE = class extends Ke {
    constructor(t6 = void 0, e = void 0, s = void 0) {
      super();
      __publicField(this, "type", "SliceExpression");
      this.start = t6, this.stop = e, this.step = s;
    }
  };
  var yE = class extends Ke {
    constructor(t6, e) {
      super();
      __publicField(this, "type", "KeywordArgumentExpression");
      this.key = t6, this.value = e;
    }
  };
  var bE = class extends Ke {
    constructor(t6) {
      super();
      __publicField(this, "type", "SpreadExpression");
      this.argument = t6;
    }
  };
  var kE = class extends it {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "CallStatement");
      this.call = t6, this.callerArgs = e, this.body = s;
    }
  };
  var vE = class extends Ke {
    constructor(t6, e, s) {
      super();
      __publicField(this, "type", "Ternary");
      this.condition = t6, this.trueExpr = e, this.falseExpr = s;
    }
  };
  function EE(t6) {
    let e = new tE([]), s = 0;
    function r(A, O) {
      let z = t6[s++];
      if (!z || z.type !== A) throw new Error(`Parser Error: ${O}. ${z.type} !== ${A}.`);
      return z;
    }
    function n(A) {
      if (!l(A)) throw new SyntaxError(`Expected ${A}`);
      ++s;
    }
    function o() {
      switch (t6[s].type) {
        case M.Comment:
          return new lE(t6[s++].value);
        case M.Text:
          return c();
        case M.OpenStatement:
          return p();
        case M.OpenExpression:
          return u();
        default:
          throw new SyntaxError(`Unexpected token type: ${t6[s].type}`);
      }
    }
    function i(...A) {
      return s + A.length <= t6.length && A.every((O, z) => O === t6[s + z].type);
    }
    function a(...A) {
      return t6[s]?.type === M.OpenStatement && t6[s + 1]?.type === M.Identifier && A.includes(t6[s + 1]?.value);
    }
    function l(...A) {
      return s + A.length <= t6.length && A.every((O, z) => t6[s + z].type === "Identifier" && O === t6[s + z].value);
    }
    function c() {
      return new a0(r(M.Text, "Expected text token").value);
    }
    function p() {
      if (r(M.OpenStatement, "Expected opening statement token"), t6[s].type !== M.Identifier) throw new SyntaxError(`Unknown statement, got ${t6[s].type}`);
      let A = t6[s].value, O;
      switch (A) {
        case "set":
          ++s, O = _();
          break;
        case "if":
          ++s, O = d(), r(M.OpenStatement, "Expected {% token"), n("endif"), r(M.CloseStatement, "Expected %} token");
          break;
        case "macro":
          ++s, O = m(), r(M.OpenStatement, "Expected {% token"), n("endmacro"), r(M.CloseStatement, "Expected %} token");
          break;
        case "for":
          ++s, O = g(), r(M.OpenStatement, "Expected {% token"), n("endfor"), r(M.CloseStatement, "Expected %} token");
          break;
        case "call": {
          ++s;
          let z = null;
          i(M.OpenParen) && (z = C());
          let G = R();
          if (G.type !== "Identifier") throw new SyntaxError("Expected identifier following call statement");
          let ee = C();
          r(M.CloseStatement, "Expected closing statement token");
          let Le = [];
          for (; !a("endcall"); ) Le.push(o());
          r(M.OpenStatement, "Expected '{%'"), n("endcall"), r(M.CloseStatement, "Expected closing statement token");
          let re = new i0(G, ee);
          O = new kE(re, z, Le);
          break;
        }
        case "break":
          ++s, r(M.CloseStatement, "Expected closing statement token"), O = new nE();
          break;
        case "continue":
          ++s, r(M.CloseStatement, "Expected closing statement token"), O = new oE();
          break;
        case "filter": {
          ++s;
          let z = R();
          z instanceof Ts && i(M.OpenParen) && (z = $(z)), r(M.CloseStatement, "Expected closing statement token");
          let G = [];
          for (; !a("endfilter"); ) G.push(o());
          r(M.OpenStatement, "Expected '{%'"), n("endfilter"), r(M.CloseStatement, "Expected '%}'"), O = new fE(z, G);
          break;
        }
        default:
          throw new SyntaxError(`Unknown statement type: ${A}`);
      }
      return O;
    }
    function u() {
      r(M.OpenExpression, "Expected opening expression token");
      let A = x();
      return r(M.CloseExpression, "Expected closing expression token"), A;
    }
    function _() {
      let A = f(), O = null, z = [];
      if (i(M.Equals)) ++s, O = f();
      else {
        for (r(M.CloseStatement, "Expected %} token"); !a("endset"); ) z.push(o());
        r(M.OpenStatement, "Expected {% token"), n("endset");
      }
      return r(M.CloseStatement, "Expected closing statement token"), new iE(A, O, z);
    }
    function d() {
      let A = x();
      r(M.CloseStatement, "Expected closing statement token");
      let O = [], z = [];
      for (; !a("elif", "else", "endif"); ) O.push(o());
      if (a("elif")) {
        ++s, ++s;
        let G = d();
        z.push(G);
      } else if (a("else")) for (++s, ++s, r(M.CloseStatement, "Expected closing statement token"); !a("endif"); ) z.push(o());
      return new sE(A, O, z);
    }
    function m() {
      let A = R();
      if (A.type !== "Identifier") throw new SyntaxError("Expected identifier following macro statement");
      let O = C();
      r(M.CloseStatement, "Expected closing statement token");
      let z = [];
      for (; !a("endmacro"); ) z.push(o());
      return new aE(A, O, z);
    }
    function f(A = false) {
      let O = A ? R : x, z = [O()], G = i(M.Comma);
      for (; G && (++s, z.push(O()), !!i(M.Comma)); ) ;
      return G ? new l0(z) : z[0];
    }
    function g() {
      let A = f(true);
      if (!(A instanceof Ts || A instanceof l0)) throw new SyntaxError(`Expected identifier/tuple for the loop variable, got ${A.type} instead`);
      if (!l("in")) throw new SyntaxError("Expected `in` keyword following loop variable");
      ++s;
      let O = x();
      r(M.CloseStatement, "Expected closing statement token");
      let z = [];
      for (; !a("endfor", "else"); ) z.push(o());
      let G = [];
      if (a("else")) for (++s, ++s, r(M.CloseStatement, "Expected closing statement token"); !a("endfor"); ) G.push(o());
      return new rE(A, O, z, G);
    }
    function x() {
      return w();
    }
    function w() {
      let A = y();
      if (l("if")) {
        ++s;
        let O = y();
        if (l("else")) {
          ++s;
          let z = w();
          return new vE(O, A, z);
        } else return new hE(A, O);
      }
      return A;
    }
    function y() {
      let A = b();
      for (; l("or"); ) {
        let O = t6[s];
        ++s;
        let z = b();
        A = new zr(O, A, z);
      }
      return A;
    }
    function b() {
      let A = v();
      for (; l("and"); ) {
        let O = t6[s];
        ++s;
        let z = v();
        A = new zr(O, A, z);
      }
      return A;
    }
    function v() {
      let A;
      for (; l("not"); ) {
        let O = t6[s];
        ++s;
        let z = v();
        A = new xE(O, z);
      }
      return A ?? k();
    }
    function k() {
      let A = S();
      for (; ; ) {
        let O;
        if (l("not", "in")) O = new Ze("not in", M.Identifier), s += 2;
        else if (l("in")) O = t6[s++];
        else if (i(M.ComparisonBinaryOperator)) O = t6[s++];
        else break;
        let z = S();
        A = new zr(O, A, z);
      }
      return A;
    }
    function S() {
      let A = H();
      for (; i(M.AdditiveBinaryOperator); ) {
        let O = t6[s];
        ++s;
        let z = H();
        A = new zr(O, A, z);
      }
      return A;
    }
    function I() {
      let A = B(R());
      return i(M.OpenParen) ? $(A) : A;
    }
    function $(A) {
      let O = new i0(A, C());
      return O = B(O), i(M.OpenParen) && (O = $(O)), O;
    }
    function C() {
      r(M.OpenParen, "Expected opening parenthesis for arguments list");
      let A = q();
      return r(M.CloseParen, "Expected closing parenthesis for arguments list"), A;
    }
    function q() {
      let A = [];
      for (; !i(M.CloseParen); ) {
        let O;
        if (t6[s].type === M.MultiplicativeBinaryOperator && t6[s].value === "*") {
          ++s;
          let z = x();
          O = new bE(z);
        } else if (O = x(), i(M.Equals)) {
          if (++s, !(O instanceof Ts)) throw new SyntaxError("Expected identifier for keyword argument");
          let z = x();
          O = new yE(O, z);
        }
        A.push(O), i(M.Comma) && ++s;
      }
      return A;
    }
    function D() {
      let A = [], O = false;
      for (; !i(M.CloseSquareBracket); ) i(M.Colon) ? (A.push(void 0), ++s, O = true) : (A.push(x()), i(M.Colon) && (++s, O = true));
      if (A.length === 0) throw new SyntaxError("Expected at least one argument for member/slice expression");
      if (O) {
        if (A.length > 3) throw new SyntaxError("Expected 0-3 arguments for slice expression");
        return new wE(...A);
      }
      return A[0];
    }
    function B(A) {
      for (; i(M.Dot) || i(M.OpenSquareBracket); ) {
        let O = t6[s];
        ++s;
        let z, G = O.type === M.OpenSquareBracket;
        if (G) z = D(), r(M.CloseSquareBracket, "Expected closing square bracket");
        else if (z = R(), z.type !== "Identifier") throw new SyntaxError("Expected identifier following dot operator");
        A = new cE(A, z, G);
      }
      return A;
    }
    function H() {
      let A = V();
      for (; i(M.MultiplicativeBinaryOperator); ) {
        let O = t6[s++], z = V();
        A = new zr(O, A, z);
      }
      return A;
    }
    function V() {
      let A = Z();
      for (; l("is"); ) {
        ++s;
        let O = l("not");
        O && ++s;
        let z = R();
        if (!(z instanceof Ts)) throw new SyntaxError("Expected identifier for the test");
        A = new gE(A, O, z);
      }
      return A;
    }
    function Z() {
      let A = I();
      for (; i(M.Pipe); ) {
        ++s;
        let O = R();
        if (!(O instanceof Ts)) throw new SyntaxError("Expected identifier for the filter");
        i(M.OpenParen) && (O = $(O)), A = new mE(A, O);
      }
      return A;
    }
    function R() {
      let A = t6[s++];
      switch (A.type) {
        case M.NumericLiteral: {
          let O = A.value;
          return O.includes(".") ? new uE(Number(O)) : new pE(Number(O));
        }
        case M.StringLiteral: {
          let O = A.value;
          for (; i(M.StringLiteral); ) O += t6[s++].value;
          return new a0(O);
        }
        case M.Identifier:
          return new Ts(A.value);
        case M.OpenParen: {
          let O = f();
          return r(M.CloseParen, "Expected closing parenthesis, got ${tokens[current].type} instead."), O;
        }
        case M.OpenSquareBracket: {
          let O = [];
          for (; !i(M.CloseSquareBracket); ) O.push(x()), i(M.Comma) && ++s;
          return ++s, new _E(O);
        }
        case M.OpenCurlyBracket: {
          let O = /* @__PURE__ */ new Map();
          for (; !i(M.CloseCurlyBracket); ) {
            let z = x();
            r(M.Colon, "Expected colon between key and value in object literal");
            let G = x();
            O.set(z, G), i(M.Comma) && ++s;
          }
          return ++s, new dE(O);
        }
        default:
          throw new SyntaxError(`Unexpected token: ${A.type}`);
      }
    }
    for (; s < t6.length; ) e.body.push(o());
    return e;
  }
  function AE(t6, e, s = 1) {
    if (e === void 0 && (e = t6, t6 = 0), s === 0) throw new Error("range() step must not be zero");
    let r = [];
    if (s > 0) for (let n = t6; n < e; n += s) r.push(n);
    else for (let n = t6; n > e; n += s) r.push(n);
    return r;
  }
  function c0(t6, e, s, r = 1) {
    let n = Math.sign(r);
    n >= 0 ? (e = (e ?? (e = 0)) < 0 ? Math.max(t6.length + e, 0) : Math.min(e, t6.length), s = (s ?? (s = t6.length)) < 0 ? Math.max(t6.length + s, 0) : Math.min(s, t6.length)) : (e = (e ?? (e = t6.length - 1)) < 0 ? Math.max(t6.length + e, -1) : Math.min(e, t6.length - 1), s = (s ?? (s = -1)) < -1 ? Math.max(t6.length + s, -1) : Math.min(s, t6.length - 1));
    let o = [];
    for (let i = e; n * i < n * s; i += r) o.push(t6[i]);
    return o;
  }
  function ME(t6) {
    return t6.replace(/\b\w/g, (e) => e.toUpperCase());
  }
  function SE(t6) {
    return OE(/* @__PURE__ */ new Date(), t6);
  }
  function OE(t6, e) {
    let s = new Intl.DateTimeFormat(void 0, { month: "long" }), r = new Intl.DateTimeFormat(void 0, { month: "short" }), n = (o) => o < 10 ? "0" + o : o.toString();
    return e.replace(/%[YmdbBHM%]/g, (o) => {
      switch (o) {
        case "%Y":
          return t6.getFullYear().toString();
        case "%m":
          return n(t6.getMonth() + 1);
        case "%d":
          return n(t6.getDate());
        case "%b":
          return r.format(t6);
        case "%B":
          return s.format(t6);
        case "%H":
          return n(t6.getHours());
        case "%M":
          return n(t6.getMinutes());
        case "%%":
          return "%";
        default:
          return o;
      }
    });
  }
  function IE(t6) {
    return t6.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  function zE(t6, e, s, r) {
    if (r === 0) return t6;
    let n = r == null || r < 0 ? 1 / 0 : r, o = e.length === 0 ? new RegExp("(?=)", "gu") : new RegExp(IE(e), "gu");
    return t6.replaceAll(o, (i) => n > 0 ? (--n, s) : i);
  }
  var p0 = class extends Error {
  };
  var u0 = class extends Error {
  };
  var dt = class {
    constructor(t6 = void 0) {
      __publicField(this, "type", "RuntimeValue");
      __publicField(this, "value");
      __publicField(this, "builtins", /* @__PURE__ */ new Map());
      this.value = t6;
    }
    __bool__() {
      return new Q(!!this.value);
    }
    toString() {
      return String(this.value);
    }
  };
  var te = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "IntegerValue");
    }
  };
  var Ae = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "FloatValue");
    }
    toString() {
      return this.value % 1 === 0 ? this.value.toFixed(1) : this.value.toString();
    }
  };
  var j = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "StringValue");
      __publicField(this, "builtins", /* @__PURE__ */ new Map([["upper", new ye(() => new j(this.value.toUpperCase()))], ["lower", new ye(() => new j(this.value.toLowerCase()))], ["strip", new ye(() => new j(this.value.trim()))], ["title", new ye(() => new j(ME(this.value)))], ["capitalize", new ye(() => new j(this.value.charAt(0).toUpperCase() + this.value.slice(1)))], ["length", new te(this.value.length)], ["rstrip", new ye(() => new j(this.value.trimEnd()))], ["lstrip", new ye(() => new j(this.value.trimStart()))], ["startswith", new ye((t6) => {
        if (t6.length === 0) throw new Error("startswith() requires at least one argument");
        let e = t6[0];
        if (e instanceof j) return new Q(this.value.startsWith(e.value));
        if (e instanceof oe) {
          for (let s of e.value) {
            if (!(s instanceof j)) throw new Error("startswith() tuple elements must be strings");
            if (this.value.startsWith(s.value)) return new Q(true);
          }
          return new Q(false);
        }
        throw new Error("startswith() argument must be a string or tuple of strings");
      })], ["endswith", new ye((t6) => {
        if (t6.length === 0) throw new Error("endswith() requires at least one argument");
        let e = t6[0];
        if (e instanceof j) return new Q(this.value.endsWith(e.value));
        if (e instanceof oe) {
          for (let s of e.value) {
            if (!(s instanceof j)) throw new Error("endswith() tuple elements must be strings");
            if (this.value.endsWith(s.value)) return new Q(true);
          }
          return new Q(false);
        }
        throw new Error("endswith() argument must be a string or tuple of strings");
      })], ["split", new ye((t6) => {
        let e = t6[0] ?? new be();
        if (!(e instanceof j || e instanceof be)) throw new Error("sep argument must be a string or null");
        let s = t6[1] ?? new te(-1);
        if (!(s instanceof te)) throw new Error("maxsplit argument must be a number");
        let r = [];
        if (e instanceof be) {
          let n = this.value.trimStart();
          for (let { 0: o, index: i } of n.matchAll(/\S+/g)) {
            if (s.value !== -1 && r.length >= s.value && i !== void 0) {
              r.push(o + n.slice(i + o.length));
              break;
            }
            r.push(o);
          }
        } else {
          if (e.value === "") throw new Error("empty separator");
          r = this.value.split(e.value), s.value !== -1 && r.length > s.value && r.push(r.splice(s.value).join(e.value));
        }
        return new oe(r.map((n) => new j(n)));
      })], ["replace", new ye((t6) => {
        if (t6.length < 2) throw new Error("replace() requires at least two arguments");
        let e = t6[0], s = t6[1];
        if (!(e instanceof j && s instanceof j)) throw new Error("replace() arguments must be strings");
        let r;
        if (t6.length > 2 ? t6[2].type === "KeywordArgumentsValue" ? r = t6[2].value.get("count") ?? new be() : r = t6[2] : r = new be(), !(r instanceof te || r instanceof be)) throw new Error("replace() count argument must be a number or null");
        return new j(zE(this.value, e.value, s.value, r.value));
      })]]));
    }
  };
  var Q = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "BooleanValue");
    }
  };
  var TE = /[\x7f-\uffff]/g;
  function _0(t6) {
    return t6.replace(TE, (e) => "\\u" + e.charCodeAt(0).toString(16).padStart(4, "0"));
  }
  function rs(t6, e = {}, s = 0, r = true) {
    let { indent: n = null, ensureAscii: o = false, separators: i = null, sortKeys: a = false } = e, l, c;
    switch (i ? [l, c] = i : n ? (l = ",", c = ": ") : (l = ", ", c = ": "), t6.type) {
      case "NullValue":
        return "null";
      case "UndefinedValue":
        return r ? "null" : "undefined";
      case "IntegerValue":
      case "FloatValue":
      case "BooleanValue":
        return JSON.stringify(t6.value);
      case "StringValue": {
        let p = JSON.stringify(t6.value);
        return o && (p = _0(p)), p;
      }
      case "ArrayValue":
      case "ObjectValue": {
        let p = n ? " ".repeat(n) : "", u = `
` + p.repeat(s), _ = u + p;
        if (t6.type === "ArrayValue") {
          let d = t6.value.map((m) => rs(m, e, s + 1, r));
          return n ? `[${_}${d.join(`${l}${_}`)}${u}]` : `[${d.join(l)}]`;
        } else {
          let d = Array.from(t6.value.entries());
          a && (d = d.sort(([f], [g]) => f.localeCompare(g)));
          let m = d.map(([f, g]) => {
            let x = JSON.stringify(f);
            o && (x = _0(x));
            let w = `${x}${c}${rs(g, e, s + 1, r)}`;
            return n ? `${_}${w}` : w;
          });
          return n ? `{${m.join(l)}${u}}` : `{${m.join(l)}}`;
        }
      }
      default:
        throw new Error(`Cannot convert to JSON: ${t6.type}`);
    }
  }
  var Pe = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "ObjectValue");
      __publicField(this, "builtins", /* @__PURE__ */ new Map([["get", new ye(([t6, e]) => {
        if (!(t6 instanceof j)) throw new Error(`Object key must be a string: got ${t6.type}`);
        return this.value.get(t6.value) ?? e ?? new be();
      })], ["items", new ye(() => this.items())], ["keys", new ye(() => this.keys())], ["values", new ye(() => this.values())], ["dictsort", new ye((t6) => {
        let e = /* @__PURE__ */ new Map(), s = t6.filter((a) => a instanceof Tr ? (e = a.value, false) : true), r = s.at(0) ?? e.get("case_sensitive") ?? new Q(false);
        if (!(r instanceof Q)) throw new Error("case_sensitive must be a boolean");
        let n = s.at(1) ?? e.get("by") ?? new j("key");
        if (!(n instanceof j)) throw new Error("by must be a string");
        if (!["key", "value"].includes(n.value)) throw new Error("by must be either 'key' or 'value'");
        let o = s.at(2) ?? e.get("reverse") ?? new Q(false);
        if (!(o instanceof Q)) throw new Error("reverse must be a boolean");
        let i = Array.from(this.value.entries()).map(([a, l]) => new oe([new j(a), l])).sort((a, l) => {
          let c = n.value === "key" ? 0 : 1, p = a.value[c], u = l.value[c], _ = Vc(p, u, r.value);
          return o.value ? -_ : _;
        });
        return new oe(i);
      })]]));
    }
    __bool__() {
      return new Q(this.value.size > 0);
    }
    items() {
      return new oe(Array.from(this.value.entries()).map(([t6, e]) => new oe([new j(t6), e])));
    }
    keys() {
      return new oe(Array.from(this.value.keys()).map((t6) => new j(t6)));
    }
    values() {
      return new oe(Array.from(this.value.values()));
    }
    toString() {
      return rs(this, {}, 0, false);
    }
  };
  var Tr = class extends Pe {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "KeywordArgumentsValue");
    }
  };
  var oe = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "ArrayValue");
      __publicField(this, "builtins", /* @__PURE__ */ new Map([["length", new te(this.value.length)]]));
    }
    __bool__() {
      return new Q(this.value.length > 0);
    }
    toString() {
      return rs(this, {}, 0, false);
    }
  };
  var d0 = class extends oe {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "TupleValue");
    }
  };
  var ye = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "FunctionValue");
    }
  };
  var be = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "NullValue");
    }
  };
  var we = class extends dt {
    constructor() {
      super(...arguments);
      __publicField(this, "type", "UndefinedValue");
    }
  };
  var ss = class {
    constructor(t6) {
      __publicField(this, "variables", /* @__PURE__ */ new Map([["namespace", new ye((t6) => {
        if (t6.length === 0) return new Pe(/* @__PURE__ */ new Map());
        if (t6.length !== 1 || !(t6[0] instanceof Pe)) throw new Error("`namespace` expects either zero arguments or a single object argument");
        return t6[0];
      })]]));
      __publicField(this, "tests", /* @__PURE__ */ new Map([["boolean", (t6) => t6.type === "BooleanValue"], ["callable", (t6) => t6 instanceof ye], ["odd", (t6) => {
        if (!(t6 instanceof te)) throw new Error(`cannot odd on ${t6.type}`);
        return t6.value % 2 !== 0;
      }], ["even", (t6) => {
        if (!(t6 instanceof te)) throw new Error(`cannot even on ${t6.type}`);
        return t6.value % 2 === 0;
      }], ["false", (t6) => t6.type === "BooleanValue" && !t6.value], ["true", (t6) => t6.type === "BooleanValue" && t6.value], ["none", (t6) => t6.type === "NullValue"], ["string", (t6) => t6.type === "StringValue"], ["number", (t6) => t6 instanceof te || t6 instanceof Ae], ["integer", (t6) => t6 instanceof te], ["iterable", (t6) => t6.type === "ArrayValue" || t6.type === "StringValue"], ["mapping", (t6) => t6 instanceof Pe], ["sequence", (t6) => t6 instanceof oe || t6 instanceof Pe || t6 instanceof j], ["lower", (t6) => {
        let e = t6.value;
        return t6.type === "StringValue" && e === e.toLowerCase();
      }], ["upper", (t6) => {
        let e = t6.value;
        return t6.type === "StringValue" && e === e.toUpperCase();
      }], ["none", (t6) => t6.type === "NullValue"], ["defined", (t6) => t6.type !== "UndefinedValue"], ["undefined", (t6) => t6.type === "UndefinedValue"], ["equalto", (t6, e) => t6.value === e.value], ["eq", (t6, e) => t6.value === e.value]]));
      this.parent = t6;
    }
    set(t6, e) {
      return this.declareVariable(t6, ia(e));
    }
    declareVariable(t6, e) {
      if (this.variables.has(t6)) throw new SyntaxError(`Variable already declared: ${t6}`);
      return this.variables.set(t6, e), e;
    }
    setVariable(t6, e) {
      return this.variables.set(t6, e), e;
    }
    resolve(t6) {
      if (this.variables.has(t6)) return this;
      if (this.parent) return this.parent.resolve(t6);
      throw new Error(`Unknown variable: ${t6}`);
    }
    lookupVariable(t6) {
      try {
        return this.resolve(t6).variables.get(t6) ?? new we();
      } catch {
        return new we();
      }
    }
  };
  function CE(t6) {
    t6.set("false", false), t6.set("true", true), t6.set("none", null), t6.set("raise_exception", (e) => {
      throw new Error(e);
    }), t6.set("range", AE), t6.set("strftime_now", SE), t6.set("True", true), t6.set("False", false), t6.set("None", null);
  }
  function m0(t6, e) {
    let s = e.split("."), r = t6;
    for (let n of s) if (r instanceof Pe) r = r.value.get(n) ?? new we();
    else if (r instanceof oe) {
      let o = parseInt(n, 10);
      if (!isNaN(o) && o >= 0 && o < r.value.length) r = r.value[o];
      else return new we();
    } else return new we();
    return r;
  }
  function Vc(t6, e, s = false) {
    if (t6 instanceof be && e instanceof be) return 0;
    if (t6 instanceof be || e instanceof be) throw new Error(`Cannot compare ${t6.type} with ${e.type}`);
    if (t6 instanceof we && e instanceof we) return 0;
    if (t6 instanceof we || e instanceof we) throw new Error(`Cannot compare ${t6.type} with ${e.type}`);
    let r = (o) => o instanceof te || o instanceof Ae || o instanceof Q, n = (o) => o instanceof Q ? o.value ? 1 : 0 : o.value;
    if (r(t6) && r(e)) {
      let o = n(t6), i = n(e);
      return o < i ? -1 : o > i ? 1 : 0;
    }
    if (t6.type !== e.type) throw new Error(`Cannot compare different types: ${t6.type} and ${e.type}`);
    if (t6.type === "StringValue") {
      let o = t6.value, i = e.value;
      return s || (o = o.toLowerCase(), i = i.toLowerCase()), o < i ? -1 : o > i ? 1 : 0;
    } else throw new Error(`Cannot compare type: ${t6.type}`);
  }
  var PE = class {
    constructor(t6) {
      __publicField(this, "global");
      this.global = t6 ?? new ss();
    }
    run(t6) {
      return this.evaluate(t6, this.global);
    }
    evaluateBinaryExpression(t6, e) {
      let s = this.evaluate(t6.left, e);
      switch (t6.operator.value) {
        case "and":
          return s.__bool__().value ? this.evaluate(t6.right, e) : s;
        case "or":
          return s.__bool__().value ? s : this.evaluate(t6.right, e);
      }
      let r = this.evaluate(t6.right, e);
      switch (t6.operator.value) {
        case "==":
          return new Q(s.value == r.value);
        case "!=":
          return new Q(s.value != r.value);
      }
      if (s instanceof we || r instanceof we) {
        if (r instanceof we && ["in", "not in"].includes(t6.operator.value)) return new Q(t6.operator.value === "not in");
        throw new Error(`Cannot perform operation ${t6.operator.value} on undefined values`);
      } else {
        if (s instanceof be || r instanceof be) throw new Error("Cannot perform operation on null values");
        if (t6.operator.value === "~") return new j(s.value.toString() + r.value.toString());
        if ((s instanceof te || s instanceof Ae) && (r instanceof te || r instanceof Ae)) {
          let n = s.value, o = r.value;
          switch (t6.operator.value) {
            case "+":
            case "-":
            case "*": {
              let i = t6.operator.value === "+" ? n + o : t6.operator.value === "-" ? n - o : n * o;
              return s instanceof Ae || r instanceof Ae ? new Ae(i) : new te(i);
            }
            case "/":
              return new Ae(n / o);
            case "%": {
              let i = n % o;
              return s instanceof Ae || r instanceof Ae ? new Ae(i) : new te(i);
            }
            case "<":
              return new Q(n < o);
            case ">":
              return new Q(n > o);
            case ">=":
              return new Q(n >= o);
            case "<=":
              return new Q(n <= o);
          }
        } else if (s instanceof oe && r instanceof oe) {
          if (t6.operator.value === "+") return new oe(s.value.concat(r.value));
        } else if (r instanceof oe) {
          let n = r.value.find((o) => o.value === s.value) !== void 0;
          switch (t6.operator.value) {
            case "in":
              return new Q(n);
            case "not in":
              return new Q(!n);
          }
        }
      }
      if ((s instanceof j || r instanceof j) && t6.operator.value === "+") return new j(s.value.toString() + r.value.toString());
      if (s instanceof j && r instanceof j) switch (t6.operator.value) {
        case "in":
          return new Q(r.value.includes(s.value));
        case "not in":
          return new Q(!r.value.includes(s.value));
      }
      if (s instanceof j && r instanceof Pe) switch (t6.operator.value) {
        case "in":
          return new Q(r.value.has(s.value));
        case "not in":
          return new Q(!r.value.has(s.value));
      }
      throw new SyntaxError(`Unknown operator "${t6.operator.value}" between ${s.type} and ${r.type}`);
    }
    evaluateArguments(t6, e) {
      let s = [], r = /* @__PURE__ */ new Map();
      for (let n of t6) if (n.type === "SpreadExpression") {
        let o = n, i = this.evaluate(o.argument, e);
        if (!(i instanceof oe)) throw new Error(`Cannot unpack non-iterable type: ${i.type}`);
        for (let a of i.value) s.push(a);
      } else if (n.type === "KeywordArgumentExpression") {
        let o = n;
        r.set(o.key.value, this.evaluate(o.value, e));
      } else {
        if (r.size > 0) throw new Error("Positional arguments must come before keyword arguments");
        s.push(this.evaluate(n, e));
      }
      return [s, r];
    }
    applyFilter(t6, e, s) {
      if (e.type === "Identifier") {
        let r = e;
        if (r.value === "safe") return t6;
        if (r.value === "tojson") return new j(rs(t6, {}));
        if (t6 instanceof oe) switch (r.value) {
          case "list":
            return t6;
          case "first":
            return t6.value[0];
          case "last":
            return t6.value[t6.value.length - 1];
          case "length":
            return new te(t6.value.length);
          case "reverse":
            return new oe(t6.value.slice().reverse());
          case "sort":
            return new oe(t6.value.slice().sort((n, o) => Vc(n, o, false)));
          case "join":
            return new j(t6.value.map((n) => n.value).join(""));
          case "string":
            return new j(rs(t6, {}, 0, false));
          case "unique": {
            let n = /* @__PURE__ */ new Set(), o = [];
            for (let i of t6.value) n.has(i.value) || (n.add(i.value), o.push(i));
            return new oe(o);
          }
          default:
            throw new Error(`Unknown ArrayValue filter: ${r.value}`);
        }
        else if (t6 instanceof j) switch (r.value) {
          case "length":
          case "upper":
          case "lower":
          case "title":
          case "capitalize": {
            let n = t6.builtins.get(r.value);
            if (n instanceof ye) return n.value([], s);
            if (n instanceof te) return n;
            throw new Error(`Unknown StringValue filter: ${r.value}`);
          }
          case "trim":
            return new j(t6.value.trim());
          case "indent":
            return new j(t6.value.split(`
`).map((n, o) => o === 0 || n.length === 0 ? n : "    " + n).join(`
`));
          case "join":
          case "string":
            return t6;
          case "int": {
            let n = parseInt(t6.value, 10);
            return new te(isNaN(n) ? 0 : n);
          }
          case "float": {
            let n = parseFloat(t6.value);
            return new Ae(isNaN(n) ? 0 : n);
          }
          default:
            throw new Error(`Unknown StringValue filter: ${r.value}`);
        }
        else if (t6 instanceof te || t6 instanceof Ae) switch (r.value) {
          case "abs":
            return t6 instanceof te ? new te(Math.abs(t6.value)) : new Ae(Math.abs(t6.value));
          case "int":
            return new te(Math.floor(t6.value));
          case "float":
            return new Ae(t6.value);
          case "string":
            return new j(t6.toString());
          default:
            throw new Error(`Unknown NumericValue filter: ${r.value}`);
        }
        else if (t6 instanceof Pe) switch (r.value) {
          case "items":
            return new oe(Array.from(t6.value.entries()).map(([n, o]) => new oe([new j(n), o])));
          case "length":
            return new te(t6.value.size);
          default: {
            let n = t6.builtins.get(r.value);
            if (n) return n instanceof ye ? n.value([], s) : n;
            throw new Error(`Unknown ObjectValue filter: ${r.value}`);
          }
        }
        else if (t6 instanceof Q) switch (r.value) {
          case "bool":
            return new Q(t6.value);
          case "int":
            return new te(t6.value ? 1 : 0);
          case "float":
            return new Ae(t6.value ? 1 : 0);
          case "string":
            return new j(t6.value ? "true" : "false");
          default:
            throw new Error(`Unknown BooleanValue filter: ${r.value}`);
        }
        throw new Error(`Cannot apply filter "${r.value}" to type: ${t6.type}`);
      } else if (e.type === "CallExpression") {
        let r = e;
        if (r.callee.type !== "Identifier") throw new Error(`Unknown filter: ${r.callee.type}`);
        let n = r.callee.value;
        if (n === "tojson") {
          let [, o] = this.evaluateArguments(r.args, s), i = o.get("indent") ?? new be();
          if (!(i instanceof te || i instanceof be)) throw new Error("If set, indent must be a number");
          let a = o.get("ensure_ascii") ?? new Q(false);
          if (!(a instanceof Q)) throw new Error("If set, ensure_ascii must be a boolean");
          let l = o.get("sort_keys") ?? new Q(false);
          if (!(l instanceof Q)) throw new Error("If set, sort_keys must be a boolean");
          let c = o.get("separators") ?? new be(), p = null;
          if (c instanceof oe || c instanceof d0) {
            if (c.value.length !== 2) throw new Error("separators must be a tuple of two strings");
            let [u, _] = c.value;
            if (!(u instanceof j) || !(_ instanceof j)) throw new Error("separators must be a tuple of two strings");
            p = [u.value, _.value];
          } else if (!(c instanceof be)) throw new Error("If set, separators must be a tuple of two strings");
          return new j(rs(t6, { indent: i.value, ensureAscii: a.value, sortKeys: l.value, separators: p }));
        } else if (n === "join") {
          let o;
          if (t6 instanceof j) o = Array.from(t6.value);
          else if (t6 instanceof oe) o = t6.value.map((c) => c.value);
          else throw new Error(`Cannot apply filter "${n}" to type: ${t6.type}`);
          let [i, a] = this.evaluateArguments(r.args, s), l = i.at(0) ?? a.get("separator") ?? new j("");
          if (!(l instanceof j)) throw new Error("separator must be a string");
          return new j(o.join(l.value));
        } else if (n === "int" || n === "float") {
          let [o, i] = this.evaluateArguments(r.args, s), a = o.at(0) ?? i.get("default") ?? (n === "int" ? new te(0) : new Ae(0));
          if (t6 instanceof j) {
            let l = n === "int" ? parseInt(t6.value, 10) : parseFloat(t6.value);
            return isNaN(l) ? a : n === "int" ? new te(l) : new Ae(l);
          } else {
            if (t6 instanceof te || t6 instanceof Ae) return t6;
            if (t6 instanceof Q) return n === "int" ? new te(t6.value ? 1 : 0) : new Ae(t6.value ? 1 : 0);
            throw new Error(`Cannot apply filter "${n}" to type: ${t6.type}`);
          }
        } else if (n === "default") {
          let [o, i] = this.evaluateArguments(r.args, s), a = o[0] ?? new j(""), l = o[1] ?? i.get("boolean") ?? new Q(false);
          if (!(l instanceof Q)) throw new Error("`default` filter flag must be a boolean");
          return t6 instanceof we || l.value && !t6.__bool__().value ? a : t6;
        }
        if (t6 instanceof oe) {
          switch (n) {
            case "sort": {
              let [o, i] = this.evaluateArguments(r.args, s), a = o.at(0) ?? i.get("reverse") ?? new Q(false);
              if (!(a instanceof Q)) throw new Error("reverse must be a boolean");
              let l = o.at(1) ?? i.get("case_sensitive") ?? new Q(false);
              if (!(l instanceof Q)) throw new Error("case_sensitive must be a boolean");
              let c = o.at(2) ?? i.get("attribute") ?? new be();
              if (!(c instanceof j || c instanceof te || c instanceof be)) throw new Error("attribute must be a string, integer, or null");
              let p = (u) => {
                if (c instanceof be) return u;
                let _ = c instanceof te ? String(c.value) : c.value;
                return m0(u, _);
              };
              return new oe(t6.value.slice().sort((u, _) => {
                let d = p(u), m = p(_), f = Vc(d, m, l.value);
                return a.value ? -f : f;
              }));
            }
            case "selectattr":
            case "rejectattr": {
              let o = n === "selectattr";
              if (t6.value.some((u) => !(u instanceof Pe))) throw new Error(`\`${n}\` can only be applied to array of objects`);
              if (r.args.some((u) => u.type !== "StringLiteral")) throw new Error(`arguments of \`${n}\` must be strings`);
              let [i, a, l] = r.args.map((u) => this.evaluate(u, s)), c;
              if (a) {
                let u = s.tests.get(a.value);
                if (!u) throw new Error(`Unknown test: ${a.value}`);
                c = u;
              } else c = (...u) => u[0].__bool__().value;
              let p = t6.value.filter((u) => {
                let _ = u.value.get(i.value), d = _ ? c(_, l) : false;
                return o ? d : !d;
              });
              return new oe(p);
            }
            case "map": {
              let [, o] = this.evaluateArguments(r.args, s);
              if (o.has("attribute")) {
                let i = o.get("attribute");
                if (!(i instanceof j)) throw new Error("attribute must be a string");
                let a = o.get("default"), l = t6.value.map((c) => {
                  if (!(c instanceof Pe)) throw new Error("items in map must be an object");
                  let p = m0(c, i.value);
                  return p instanceof we ? a ?? new we() : p;
                });
                return new oe(l);
              } else throw new Error("`map` expressions without `attribute` set are not currently supported.");
            }
          }
          throw new Error(`Unknown ArrayValue filter: ${n}`);
        } else if (t6 instanceof j) {
          switch (n) {
            case "indent": {
              let [o, i] = this.evaluateArguments(r.args, s), a = o.at(0) ?? i.get("width") ?? new te(4);
              if (!(a instanceof te)) throw new Error("width must be a number");
              let l = o.at(1) ?? i.get("first") ?? new Q(false), c = o.at(2) ?? i.get("blank") ?? new Q(false), p = t6.value.split(`
`), u = " ".repeat(a.value), _ = p.map((d, m) => !l.value && m === 0 || !c.value && d.length === 0 ? d : u + d);
              return new j(_.join(`
`));
            }
            case "replace": {
              let o = t6.builtins.get("replace");
              if (!(o instanceof ye)) throw new Error("replace filter not available");
              let [i, a] = this.evaluateArguments(r.args, s);
              return o.value([...i, new Tr(a)], s);
            }
          }
          throw new Error(`Unknown StringValue filter: ${n}`);
        } else if (t6 instanceof Pe) {
          let o = t6.builtins.get(n);
          if (o && o instanceof ye) {
            let [i, a] = this.evaluateArguments(r.args, s);
            return a.size > 0 && i.push(new Tr(a)), o.value(i, s);
          }
          throw new Error(`Unknown ObjectValue filter: ${n}`);
        } else throw new Error(`Cannot apply filter "${n}" to type: ${t6.type}`);
      }
      throw new Error(`Unknown filter: ${e.type}`);
    }
    evaluateFilterExpression(t6, e) {
      let s = this.evaluate(t6.operand, e);
      return this.applyFilter(s, t6.filter, e);
    }
    evaluateTestExpression(t6, e) {
      let s = this.evaluate(t6.operand, e), r = e.tests.get(t6.test.value);
      if (!r) throw new Error(`Unknown test: ${t6.test.value}`);
      let n = r(s);
      return new Q(t6.negate ? !n : n);
    }
    evaluateSelectExpression(t6, e) {
      return this.evaluate(t6.test, e).__bool__().value ? this.evaluate(t6.lhs, e) : new we();
    }
    evaluateUnaryExpression(t6, e) {
      let s = this.evaluate(t6.argument, e);
      if (t6.operator.value === "not") return new Q(!s.value);
      throw new SyntaxError(`Unknown operator: ${t6.operator.value}`);
    }
    evaluateTernaryExpression(t6, e) {
      return this.evaluate(t6.condition, e).__bool__().value ? this.evaluate(t6.trueExpr, e) : this.evaluate(t6.falseExpr, e);
    }
    evalProgram(t6, e) {
      return this.evaluateBlock(t6.body, e);
    }
    evaluateBlock(t6, e) {
      let s = "";
      for (let r of t6) {
        let n = this.evaluate(r, e);
        n.type !== "NullValue" && n.type !== "UndefinedValue" && (s += n.toString());
      }
      return new j(s);
    }
    evaluateIdentifier(t6, e) {
      return e.lookupVariable(t6.value);
    }
    evaluateCallExpression(t6, e) {
      let [s, r] = this.evaluateArguments(t6.args, e);
      r.size > 0 && s.push(new Tr(r));
      let n = this.evaluate(t6.callee, e);
      if (n.type !== "FunctionValue") throw new Error(`Cannot call something that is not a function: got ${n.type}`);
      return n.value(s, e);
    }
    evaluateSliceExpression(t6, e, s) {
      if (!(t6 instanceof oe || t6 instanceof j)) throw new Error("Slice object must be an array or string");
      let r = this.evaluate(e.start, s), n = this.evaluate(e.stop, s), o = this.evaluate(e.step, s);
      if (!(r instanceof te || r instanceof we)) throw new Error("Slice start must be numeric or undefined");
      if (!(n instanceof te || n instanceof we)) throw new Error("Slice stop must be numeric or undefined");
      if (!(o instanceof te || o instanceof we)) throw new Error("Slice step must be numeric or undefined");
      return t6 instanceof oe ? new oe(c0(t6.value, r.value, n.value, o.value)) : new j(c0(Array.from(t6.value), r.value, n.value, o.value).join(""));
    }
    evaluateMemberExpression(t6, e) {
      let s = this.evaluate(t6.object, e), r;
      if (t6.computed) {
        if (t6.property.type === "SliceExpression") return this.evaluateSliceExpression(s, t6.property, e);
        r = this.evaluate(t6.property, e);
      } else r = new j(t6.property.value);
      let n;
      if (s instanceof Pe) {
        if (!(r instanceof j)) throw new Error(`Cannot access property with non-string: got ${r.type}`);
        n = s.value.get(r.value) ?? s.builtins.get(r.value);
      } else if (s instanceof oe || s instanceof j) if (r instanceof te) n = s.value.at(r.value), s instanceof j && (n = new j(s.value.at(r.value)));
      else if (r instanceof j) n = s.builtins.get(r.value);
      else throw new Error(`Cannot access property with non-string/non-number: got ${r.type}`);
      else {
        if (!(r instanceof j)) throw new Error(`Cannot access property with non-string: got ${r.type}`);
        n = s.builtins.get(r.value);
      }
      return n instanceof dt ? n : new we();
    }
    evaluateSet(t6, e) {
      let s = t6.value ? this.evaluate(t6.value, e) : this.evaluateBlock(t6.body, e);
      if (t6.assignee.type === "Identifier") {
        let r = t6.assignee.value;
        e.setVariable(r, s);
      } else if (t6.assignee.type === "TupleLiteral") {
        let r = t6.assignee;
        if (!(s instanceof oe)) throw new Error(`Cannot unpack non-iterable type in set: ${s.type}`);
        let n = s.value;
        if (n.length !== r.value.length) throw new Error(`Too ${r.value.length > n.length ? "few" : "many"} items to unpack in set`);
        for (let o = 0; o < r.value.length; ++o) {
          let i = r.value[o];
          if (i.type !== "Identifier") throw new Error(`Cannot unpack to non-identifier in set: ${i.type}`);
          e.setVariable(i.value, n[o]);
        }
      } else if (t6.assignee.type === "MemberExpression") {
        let r = t6.assignee, n = this.evaluate(r.object, e);
        if (!(n instanceof Pe)) throw new Error("Cannot assign to member of non-object");
        if (r.property.type !== "Identifier") throw new Error("Cannot assign to member with non-identifier property");
        n.value.set(r.property.value, s);
      } else throw new Error(`Invalid LHS inside assignment expression: ${JSON.stringify(t6.assignee)}`);
      return new be();
    }
    evaluateIf(t6, e) {
      let s = this.evaluate(t6.test, e);
      return this.evaluateBlock(s.__bool__().value ? t6.body : t6.alternate, e);
    }
    evaluateFor(t6, e) {
      let s = new ss(e), r, n;
      if (t6.iterable.type === "SelectExpression") {
        let c = t6.iterable;
        n = this.evaluate(c.lhs, s), r = c.test;
      } else n = this.evaluate(t6.iterable, s);
      if (!(n instanceof oe || n instanceof Pe)) throw new Error(`Expected iterable or object type in for loop: got ${n.type}`);
      n instanceof Pe && (n = n.keys());
      let o = [], i = [];
      for (let c = 0; c < n.value.length; ++c) {
        let p = new ss(s), u = n.value[c], _;
        if (t6.loopvar.type === "Identifier") _ = (d) => d.setVariable(t6.loopvar.value, u);
        else if (t6.loopvar.type === "TupleLiteral") {
          let d = t6.loopvar;
          if (u.type !== "ArrayValue") throw new Error(`Cannot unpack non-iterable type: ${u.type}`);
          let m = u;
          if (d.value.length !== m.value.length) throw new Error(`Too ${d.value.length > m.value.length ? "few" : "many"} items to unpack`);
          _ = (f) => {
            for (let g = 0; g < d.value.length; ++g) {
              if (d.value[g].type !== "Identifier") throw new Error(`Cannot unpack non-identifier type: ${d.value[g].type}`);
              f.setVariable(d.value[g].value, m.value[g]);
            }
          };
        } else throw new Error(`Invalid loop variable(s): ${t6.loopvar.type}`);
        r && (_(p), !this.evaluate(r, p).__bool__().value) || (o.push(u), i.push(_));
      }
      let a = "", l = true;
      for (let c = 0; c < o.length; ++c) {
        let p = /* @__PURE__ */ new Map([["index", new te(c + 1)], ["index0", new te(c)], ["revindex", new te(o.length - c)], ["revindex0", new te(o.length - c - 1)], ["first", new Q(c === 0)], ["last", new Q(c === o.length - 1)], ["length", new te(o.length)], ["previtem", c > 0 ? o[c - 1] : new we()], ["nextitem", c < o.length - 1 ? o[c + 1] : new we()]]);
        s.setVariable("loop", new Pe(p)), i[c](s);
        try {
          let u = this.evaluateBlock(t6.body, s);
          a += u.value;
        } catch (u) {
          if (u instanceof u0) continue;
          if (u instanceof p0) break;
          throw u;
        }
        l = false;
      }
      if (l) {
        let c = this.evaluateBlock(t6.defaultBlock, s);
        a += c.value;
      }
      return new j(a);
    }
    evaluateMacro(t6, e) {
      return e.setVariable(t6.name.value, new ye((s, r) => {
        let n = new ss(r);
        s = s.slice();
        let o;
        s.at(-1)?.type === "KeywordArgumentsValue" && (o = s.pop());
        for (let i = 0; i < t6.args.length; ++i) {
          let a = t6.args[i], l = s[i];
          if (a.type === "Identifier") {
            let c = a;
            if (!l) throw new Error(`Missing positional argument: ${c.value}`);
            n.setVariable(c.value, l);
          } else if (a.type === "KeywordArgumentExpression") {
            let c = a, p = l ?? o?.value.get(c.key.value) ?? this.evaluate(c.value, n);
            n.setVariable(c.key.value, p);
          } else throw new Error(`Unknown argument type: ${a.type}`);
        }
        return this.evaluateBlock(t6.body, n);
      })), new be();
    }
    evaluateCallStatement(t6, e) {
      let s = new ye((a, l) => {
        let c = new ss(l);
        if (t6.callerArgs) for (let p = 0; p < t6.callerArgs.length; ++p) {
          let u = t6.callerArgs[p];
          if (u.type !== "Identifier") throw new Error(`Caller parameter must be an identifier, got ${u.type}`);
          c.setVariable(u.value, a[p] ?? new we());
        }
        return this.evaluateBlock(t6.body, c);
      }), [r, n] = this.evaluateArguments(t6.call.args, e);
      r.push(new Tr(n));
      let o = this.evaluate(t6.call.callee, e);
      if (o.type !== "FunctionValue") throw new Error(`Cannot call something that is not a function: got ${o.type}`);
      let i = new ss(e);
      return i.setVariable("caller", s), o.value(r, i);
    }
    evaluateFilterStatement(t6, e) {
      let s = this.evaluateBlock(t6.body, e);
      return this.applyFilter(s, t6.filter, e);
    }
    evaluate(t6, e) {
      if (!t6) return new we();
      switch (t6.type) {
        case "Program":
          return this.evalProgram(t6, e);
        case "Set":
          return this.evaluateSet(t6, e);
        case "If":
          return this.evaluateIf(t6, e);
        case "For":
          return this.evaluateFor(t6, e);
        case "Macro":
          return this.evaluateMacro(t6, e);
        case "CallStatement":
          return this.evaluateCallStatement(t6, e);
        case "Break":
          throw new p0();
        case "Continue":
          throw new u0();
        case "IntegerLiteral":
          return new te(t6.value);
        case "FloatLiteral":
          return new Ae(t6.value);
        case "StringLiteral":
          return new j(t6.value);
        case "ArrayLiteral":
          return new oe(t6.value.map((s) => this.evaluate(s, e)));
        case "TupleLiteral":
          return new d0(t6.value.map((s) => this.evaluate(s, e)));
        case "ObjectLiteral": {
          let s = /* @__PURE__ */ new Map();
          for (let [r, n] of t6.value) {
            let o = this.evaluate(r, e);
            if (!(o instanceof j)) throw new Error(`Object keys must be strings: got ${o.type}`);
            s.set(o.value, this.evaluate(n, e));
          }
          return new Pe(s);
        }
        case "Identifier":
          return this.evaluateIdentifier(t6, e);
        case "CallExpression":
          return this.evaluateCallExpression(t6, e);
        case "MemberExpression":
          return this.evaluateMemberExpression(t6, e);
        case "UnaryExpression":
          return this.evaluateUnaryExpression(t6, e);
        case "BinaryExpression":
          return this.evaluateBinaryExpression(t6, e);
        case "FilterExpression":
          return this.evaluateFilterExpression(t6, e);
        case "FilterStatement":
          return this.evaluateFilterStatement(t6, e);
        case "TestExpression":
          return this.evaluateTestExpression(t6, e);
        case "SelectExpression":
          return this.evaluateSelectExpression(t6, e);
        case "Ternary":
          return this.evaluateTernaryExpression(t6, e);
        case "Comment":
          return new be();
        default:
          throw new SyntaxError(`Unknown node type: ${t6.type}`);
      }
    }
  };
  function ia(t6) {
    switch (typeof t6) {
      case "number":
        return Number.isInteger(t6) ? new te(t6) : new Ae(t6);
      case "string":
        return new j(t6);
      case "boolean":
        return new Q(t6);
      case "undefined":
        return new we();
      case "object":
        return t6 === null ? new be() : Array.isArray(t6) ? new oe(t6.map(ia)) : new Pe(new Map(Object.entries(t6).map(([e, s]) => [e, ia(s)])));
      case "function":
        return new ye((e, s) => {
          let r = t6(...e.map((n) => n.value)) ?? null;
          return ia(r);
        });
      default:
        throw new Error(`Cannot convert to runtime value: ${t6}`);
    }
  }
  var ze = `
`;
  var NE = "{%- ";
  var LE = " -%}";
  function $E(t6) {
    switch (t6.operator.type) {
      case "MultiplicativeBinaryOperator":
        return 4;
      case "AdditiveBinaryOperator":
        return 3;
      case "ComparisonBinaryOperator":
        return 2;
      case "Identifier":
        return t6.operator.value === "and" ? 1 : t6.operator.value === "in" || t6.operator.value === "not in" ? 2 : 0;
    }
    return 0;
  }
  function FE(t6, e = "	") {
    let s = typeof e == "number" ? " ".repeat(e) : e;
    return ot(t6.body, 0, s).replace(/\n$/, "");
  }
  function Re(...t6) {
    return NE + t6.join(" ") + LE;
  }
  function ot(t6, e, s) {
    return t6.map((r) => RE(r, e, s)).join(ze);
  }
  function RE(t6, e, s) {
    let r = s.repeat(e);
    switch (t6.type) {
      case "Program":
        return ot(t6.body, e, s);
      case "If":
        return DE(t6, e, s);
      case "For":
        return qE(t6, e, s);
      case "Set":
        return jE(t6, e, s);
      case "Macro":
        return BE(t6, e, s);
      case "Break":
        return r + Re("break");
      case "Continue":
        return r + Re("continue");
      case "CallStatement":
        return UE(t6, e, s);
      case "FilterStatement":
        return GE(t6, e, s);
      case "Comment":
        return r + "{# " + t6.value + " #}";
      default:
        return r + "{{- " + ae(t6) + " -}}";
    }
  }
  function DE(t6, e, s) {
    let r = s.repeat(e), n = [], o = t6;
    for (; o && (n.push({ test: o.test, body: o.body }), o.alternate.length === 1 && o.alternate[0].type === "If"); ) o = o.alternate[0];
    let i = r + Re("if", ae(n[0].test)) + ze + ot(n[0].body, e + 1, s);
    for (let a = 1; a < n.length; ++a) i += ze + r + Re("elif", ae(n[a].test)) + ze + ot(n[a].body, e + 1, s);
    return o && o.alternate.length > 0 && (i += ze + r + Re("else") + ze + ot(o.alternate, e + 1, s)), i += ze + r + Re("endif"), i;
  }
  function qE(t6, e, s) {
    let r = s.repeat(e), n = "";
    if (t6.iterable.type === "SelectExpression") {
      let i = t6.iterable;
      n = `${ae(i.lhs)} if ${ae(i.test)}`;
    } else n = ae(t6.iterable);
    let o = r + Re("for", ae(t6.loopvar), "in", n) + ze + ot(t6.body, e + 1, s);
    return t6.defaultBlock.length > 0 && (o += ze + r + Re("else") + ze + ot(t6.defaultBlock, e + 1, s)), o += ze + r + Re("endfor"), o;
  }
  function jE(t6, e, s) {
    let r = s.repeat(e), n = ae(t6.assignee), o = t6.value ? ae(t6.value) : "", i = r + Re("set", `${n}${t6.value ? " = " + o : ""}`);
    return t6.body.length === 0 ? i : i + ze + ot(t6.body, e + 1, s) + ze + r + Re("endset");
  }
  function BE(t6, e, s) {
    let r = s.repeat(e), n = t6.args.map(ae).join(", ");
    return r + Re("macro", `${t6.name.value}(${n})`) + ze + ot(t6.body, e + 1, s) + ze + r + Re("endmacro");
  }
  function UE(t6, e, s) {
    let r = s.repeat(e), n = t6.callerArgs && t6.callerArgs.length > 0 ? `(${t6.callerArgs.map(ae).join(", ")})` : "", o = ae(t6.call), i = r + Re(`call${n}`, o) + ze;
    return i += ot(t6.body, e + 1, s) + ze, i += r + Re("endcall"), i;
  }
  function GE(t6, e, s) {
    let r = s.repeat(e), n = t6.filter.type === "Identifier" ? t6.filter.value : ae(t6.filter), o = r + Re("filter", n) + ze;
    return o += ot(t6.body, e + 1, s) + ze, o += r + Re("endfilter"), o;
  }
  function ae(t6, e = -1) {
    switch (t6.type) {
      case "SpreadExpression":
        return `*${ae(t6.argument)}`;
      case "Identifier":
        return t6.value;
      case "IntegerLiteral":
        return `${t6.value}`;
      case "FloatLiteral":
        return `${t6.value}`;
      case "StringLiteral":
        return JSON.stringify(t6.value);
      case "BinaryExpression": {
        let s = t6, r = $E(s), n = ae(s.left, r), o = ae(s.right, r + 1), i = `${n} ${s.operator.value} ${o}`;
        return r < e ? `(${i})` : i;
      }
      case "UnaryExpression": {
        let s = t6;
        return s.operator.value + (s.operator.value === "not" ? " " : "") + ae(s.argument, 1 / 0);
      }
      case "CallExpression": {
        let s = t6, r = s.args.map(ae).join(", ");
        return `${ae(s.callee)}(${r})`;
      }
      case "MemberExpression": {
        let s = t6, r = ae(s.object);
        ["Identifier", "MemberExpression", "CallExpression", "StringLiteral", "IntegerLiteral", "FloatLiteral", "ArrayLiteral", "TupleLiteral", "ObjectLiteral"].includes(s.object.type) || (r = `(${r})`);
        let n = ae(s.property);
        return !s.computed && s.property.type !== "Identifier" && (n = `(${n})`), s.computed ? `${r}[${n}]` : `${r}.${n}`;
      }
      case "FilterExpression": {
        let s = t6, r = ae(s.operand, 1 / 0);
        return s.filter.type === "CallExpression" ? `${r} | ${ae(s.filter)}` : `${r} | ${s.filter.value}`;
      }
      case "SelectExpression": {
        let s = t6;
        return `${ae(s.lhs)} if ${ae(s.test)}`;
      }
      case "TestExpression": {
        let s = t6;
        return `${ae(s.operand)} is${s.negate ? " not" : ""} ${s.test.value}`;
      }
      case "ArrayLiteral":
      case "TupleLiteral": {
        let s = t6.value.map(ae), r = t6.type === "ArrayLiteral" ? "[]" : "()";
        return `${r[0]}${s.join(", ")}${r[1]}`;
      }
      case "ObjectLiteral":
        return `{${Array.from(t6.value.entries()).map(([r, n]) => `${ae(r)}: ${ae(n)}`).join(", ")}}`;
      case "SliceExpression": {
        let s = t6, r = s.start ? ae(s.start) : "", n = s.stop ? ae(s.stop) : "", o = s.step ? `:${ae(s.step)}` : "";
        return `${r}:${n}${o}`;
      }
      case "KeywordArgumentExpression": {
        let s = t6;
        return `${s.key.value}=${ae(s.value)}`;
      }
      case "Ternary": {
        let s = t6, r = `${ae(s.trueExpr)} if ${ae(s.condition, 0)} else ${ae(s.falseExpr)}`;
        return e > -1 ? `(${r})` : r;
      }
      default:
        throw new Error(`Unknown expression type: ${t6.type}`);
    }
  }
  var f0 = class {
    constructor(t6) {
      __publicField(this, "parsed");
      let e = eE(t6, { lstrip_blocks: true, trim_blocks: true });
      this.parsed = EE(e);
    }
    render(t6) {
      let e = new ss();
      if (CE(e), t6) for (let [n, o] of Object.entries(t6)) e.set(n, o);
      return new PE(e).run(this.parsed).value;
    }
    format(t6) {
      return FE(this.parsed, t6?.indent || "	");
    }
  };
  var WE = { txt: "text/plain", html: "text/html", css: "text/css", js: "text/javascript", json: "application/json", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif" };
  var Ot = class t {
    constructor(e) {
      if (this.filePath = e, this.headers = new Headers(), this.exists = $e.existsSync(e), this.exists) {
        this.status = 200, this.statusText = "OK";
        let s = $e.statSync(e);
        this.headers.set("content-length", s.size.toString()), this.updateContentType();
        let r = $e.createReadStream(e);
        this.body = new ReadableStream({ start(n) {
          r.on("data", (o) => n.enqueue(o)), r.on("end", () => n.close()), r.on("error", (o) => n.error(o));
        }, cancel() {
          r.destroy();
        } });
      } else this.status = 404, this.statusText = "Not Found", this.body = null;
    }
    updateContentType() {
      let e = this.filePath.toString().split(".").pop().toLowerCase();
      this.headers.set("content-type", WE[e] ?? "application/octet-stream");
    }
    clone() {
      let e = new t(this.filePath);
      return e.exists = this.exists, e.status = this.status, e.statusText = this.statusText, e.headers = new Headers(this.headers), e;
    }
    async arrayBuffer() {
      return (await $e.promises.readFile(this.filePath)).buffer;
    }
    async blob() {
      let e = await $e.promises.readFile(this.filePath);
      return new Blob([e], { type: this.headers.get("content-type") });
    }
    async text() {
      return await $e.promises.readFile(this.filePath, "utf8");
    }
    async json() {
      return JSON.parse(await this.text());
    }
  };
  var It = class {
    constructor(e) {
      this._mt = new Uint32Array(624), this._idx = 625, this._gauss_next = null, this._random_fn = this.random.bind(this), this.seed(e);
    }
    seed(e) {
      if (e == null) if (K.IS_CRYPTO_AVAILABLE) {
        let a = new Uint32Array(1);
        crypto.getRandomValues(a), e = a[0];
      } else e = Date.now() >>> 0;
      let s = this._mt, r = (a, l) => Math.imul(a, l) >>> 0, n = [];
      for (let a = e || 0; a > 0; a = Math.floor(a / 4294967296)) n.push(a & 4294967295);
      n.length || n.push(0), s[0] = 19650218;
      for (let a = 1; a < 624; ++a) s[a] = r(1812433253, s[a - 1] ^ s[a - 1] >>> 30) + a >>> 0;
      let o = 1, i = 0;
      for (let a = Math.max(624, n.length); a > 0; --a, ++o, ++i) o >= 624 && (s[0] = s[623], o = 1), i >= n.length && (i = 0), s[o] = (s[o] ^ r(s[o - 1] ^ s[o - 1] >>> 30, 1664525)) + n[i] + i >>> 0;
      for (let a = 623; a > 0; --a, ++o) o >= 624 && (s[0] = s[623], o = 1), s[o] = (s[o] ^ r(s[o - 1] ^ s[o - 1] >>> 30, 1566083941)) - o >>> 0;
      s[0] = 2147483648, this._idx = 624, this._gauss_next = null;
    }
    _int32() {
      let e = this._mt;
      if (this._idx >= 624) {
        for (let r = 0; r < 624; ++r) {
          let n = e[r] & 2147483648 | e[(r + 1) % 624] & 2147483647;
          e[r] = (e[(r + 397) % 624] ^ n >>> 1 ^ (n & 1 ? 2567483615 : 0)) >>> 0;
        }
        this._idx = 0;
      }
      let s = e[this._idx++];
      return s ^= s >>> 11, s ^= s << 7 & 2636928640, s ^= s << 15 & 4022730752, s ^= s >>> 18, s >>> 0;
    }
    random() {
      return ((this._int32() >>> 5) * 67108864 + (this._int32() >>> 6)) / 9007199254740992;
    }
    gauss(e = 0, s = 1) {
      let r = this._gauss_next;
      if (this._gauss_next = null, r === null) {
        let n = this.random() * 2 * Math.PI, o = Math.sqrt(-2 * Math.log(1 - this.random()));
        r = Math.cos(n) * o, this._gauss_next = Math.sin(n) * o;
      }
      return e + r * s;
    }
    shuffle(e) {
      for (let s = e.length - 1; s > 0; --s) {
        let r = 32 - Math.clz32(s + 1), n = this._int32() >>> 32 - r;
        for (; n > s; ) n = this._int32() >>> 32 - r;
        let o = e[s];
        e[s] = e[n], e[n] = o;
      }
    }
    choices(e, s) {
      return e[h0(this._random_fn, s)];
    }
  };
  function h0(t6, e) {
    let s = 0;
    for (let n = 0; n < e.length; ++n) s += e[n];
    let r = t6() * s;
    for (let n = 0; n < e.length; ++n) if (r -= e[n], r < 0) return n;
    return e.length - 1;
  }
  var mt = new It();
  var ns = Object.freeze({ Random: It, seed: mt.seed.bind(mt), random: mt.random.bind(mt), gauss: mt.gauss.bind(mt), shuffle: mt.shuffle.bind(mt), choices: mt.choices.bind(mt) });
  var g0 = (t6) => h0(ns.random, t6);
  var VE = new It();
  var Ps = class {
    constructor(e) {
      this.path = e;
    }
    async match(e) {
      let s = Ye.join(this.path, e), r = new Ot(s);
      if (r.exists) return r;
    }
    async put(e, s, r = void 0) {
      let n = Ye.join(this.path, e), o = K.IS_PROCESS_AVAILABLE ? process.pid : Date.now(), i = VE._int32().toString(36), a = n + `.tmp.${o}.${i}`;
      try {
        let l = s.headers.get("Content-Length"), c = parseInt(l ?? "0"), p = 0;
        await $e.promises.mkdir(Ye.dirname(n), { recursive: true });
        let u = $e.createWriteStream(a), _ = s.body.getReader();
        for (; ; ) {
          let { done: d, value: m } = await _.read();
          if (d) break;
          await new Promise((g, x) => {
            u.write(m, (w) => {
              if (w) {
                x(w);
                return;
              }
              g();
            });
          }), p += m.length;
          let f = c ? p / c * 100 : 0;
          r?.({ progress: f, loaded: p, total: c });
        }
        await new Promise((d, m) => {
          u.close((f) => f ? m(f) : d());
        }), await $e.promises.rename(a, n);
      } catch (l) {
        try {
          await $e.promises.unlink(a);
        } catch {
        }
        throw l;
      }
    }
    async delete(e) {
      let s = Ye.join(this.path, e);
      try {
        return await $e.promises.unlink(s), true;
      } catch {
        return false;
      }
    }
  };
  var x0 = { 400: "Bad request error occurred while trying to load file", 401: "Unauthorized access to file", 403: "Forbidden access to file", 404: "Could not locate file", 408: "Request timeout error occurred while trying to load file", 500: "Internal server error error occurred while trying to load file", 502: "Bad gateway error occurred while trying to load file", 503: "Service unavailable error occurred while trying to load file", 504: "Gateway timeout error occurred while trying to load file" };
  var aa = 100;
  var w0 = /^(\b[\w\-.]+\b\/)?\b[\w\-.]{1,96}\b$/;
  function Cr(...t6) {
    return t6 = t6.map((e, s) => (s && (e = e.replace(new RegExp("^/"), "")), s !== t6.length - 1 && (e = e.replace(new RegExp("/$"), "")), e)), t6.join("/");
  }
  function zt(t6, e = null, s = null) {
    let r;
    try {
      r = new URL(t6);
    } catch {
      return false;
    }
    return !(e && !e.includes(r.protocol) || s && !s.includes(r.hostname));
  }
  function y0(t6) {
    return !(!w0.test(t6) || t6.includes("..") || t6.includes("--") || t6.endsWith(".git") || t6.endsWith(".ipynb"));
  }
  function b0(t6, e, s) {
    if (!s) return null;
    let r = x0[t6] ?? `Error (${t6}) occurred while trying to load file`;
    throw Error(`${r}: "${e}".`);
  }
  async function k0(t6, e, s) {
    let r = t6.headers.get("Content-Length"), n = r ? parseInt(r, 10) : s ?? 0;
    r === null && !s && F.warn("Unable to determine content-length from response headers. Will expand buffer when needed.");
    let o = new Uint8Array(n), i = 0, a = t6.body.getReader();
    async function l() {
      let { done: c, value: p } = await a.read();
      if (c) return;
      let u = i + p.length;
      if (u > n) {
        n = u;
        let d = new Uint8Array(n);
        d.set(o), o = d;
      }
      o.set(p, i), i = u;
      let _ = i / n * 100;
      return e({ progress: _, loaded: i, total: n }), l();
    }
    return await l(), o;
  }
  function Hc(t6) {
    return zt(t6, ["blob:"]);
  }
  function Kc(t6) {
    let e;
    if (typeof location < "u" && location.href) e = location.href;
    else if (typeof import_meta < "u" && import_meta.url) e = import_meta.url;
    else return t6;
    return new URL(t6, e).href;
  }
  var E0 = "SHA-256";
  var HE = "experimental_transformers-hash-cache";
  var v0 = (t6) => ({ algorithm: E0, value: t6 });
  var _t2, _a;
  var Pr = (_a = class {
    constructor() {
      __privateAdd(this, _t2, null);
      __publicField(this, "_getHashCache", () => (__privateGet(this, _t2) ?? __privateSet(this, _t2, caches.open(HE)), __privateGet(this, _t2)));
      __publicField(this, "match", async (e) => {
        let s = await this._getFileHash(e);
        if (s) try {
          let [r] = await navigator.crossOriginStorage.requestFileHandles([v0(s)]), n = await r.getFile();
          return new Response(n, { headers: { "Content-Length": String(n.size) } });
        } catch {
          return;
        }
      });
      __publicField(this, "put", async (e, s) => {
        let r = await this._getFileHash(e);
        if (r) {
          let n = await s.blob();
          await this._storeBlobInCOS(n, r);
        } else this._processAndStore(e, s.body);
      });
      __publicField(this, "_storeBlobInCOS", async (e, s) => {
        let [r] = await navigator.crossOriginStorage.requestFileHandles([v0(s)], { create: true }), n = await r.createWritable();
        await n.write(e), await n.close();
      });
      __publicField(this, "_processAndStore", async (e, s) => {
        try {
          let r = [];
          for await (let i of s) r.push(i);
          let n = new Blob(r), o = await this._getBlobHash(n);
          await this._storeBlobInCOS(n, o);
          try {
            await (await this._getHashCache()).put(e, new Response(o));
          } catch {
          }
        } catch {
        }
      });
      __publicField(this, "delete", async (e) => {
        try {
          return await (await this._getHashCache()).delete(e);
        } catch {
          return false;
        }
      });
      __publicField(this, "_getFileHash", async (e) => {
        try {
          let s = await this._getHashCache(), r = await s.match(e);
          if (r) return r.text();
          let n = await this._getLfsFileHash(e);
          return n ? (await s.put(e, new Response(n)), n) : null;
        } catch {
          return null;
        }
      });
      __publicField(this, "_getLfsFileHash", async (e) => {
        if (!e.includes("/resolve/")) return null;
        let s = e.replace("/resolve/", "/raw/");
        try {
          let n = (await fetch(s).then((o) => o.text())).match(/^oid sha256:([0-9a-f]+)$/m);
          return n ? n[1] : null;
        } catch {
          return null;
        }
      });
      __publicField(this, "_getBlobHash", async (e) => {
        let s = await e.arrayBuffer(), r = await crypto.subtle.digest(E0, s);
        return Array.from(new Uint8Array(r)).map((o) => o.toString(16).padStart(2, "0")).join("");
      });
    }
  }, _t2 = new WeakMap(), __publicField(_a, "isAvailable", () => typeof navigator < "u" && "crossOriginStorage" in navigator), _a);
  async function at(t6 = null) {
    let e = null;
    if (J.useCustomCache) {
      if (!J.customCache) throw Error("`env.useCustomCache=true`, but `env.customCache` is not defined.");
      if (!J.customCache.match || !J.customCache.put) throw new Error("`env.customCache` must be an object which implements the `match` and `put` functions of the Web Cache API. For more information, see https://developer.mozilla.org/en-US/docs/Web/API/Cache");
      e = J.customCache;
    }
    if (!e && J.experimental_useCrossOriginStorage && Pr.isAvailable() && (e = new Pr()), !e && J.useBrowserCache) {
      if (typeof caches > "u") throw Error("Browser cache is not available in this environment.");
      try {
        e = await caches.open(J.cacheKey);
      } catch (s) {
        F.warn("An error occurred while opening the browser cache:", s);
      }
    }
    if (!e && J.useFSCache) {
      if (!K.IS_FS_AVAILABLE) throw Error("File System Cache is not available in this environment.");
      e = new Ps(t6 ?? J.cacheDir);
    }
    return e;
  }
  async function A0(t6, ...e) {
    for (let s of e) try {
      let r = await t6.match(s);
      if (r) return r;
    } catch {
      continue;
    }
  }
  var _t3, _e, _a2;
  var la = (_a2 = class {
    constructor(e) {
      __privateAdd(this, _t3);
      __privateAdd(this, _e);
      __privateSet(this, _t3, e), __privateSet(this, _e, /* @__PURE__ */ new Map());
    }
    get(e) {
      if (!__privateGet(this, _e).has(e)) return;
      let s = __privateGet(this, _e).get(e);
      return __privateGet(this, _e).delete(e), __privateGet(this, _e).set(e, s), s;
    }
    put(e, s) {
      __privateGet(this, _e).has(e) && __privateGet(this, _e).delete(e), __privateGet(this, _e).set(e, s), __privateGet(this, _e).size > __privateGet(this, _t3) && __privateGet(this, _e).delete(__privateGet(this, _e).keys().next().value);
    }
    delete(e) {
      return __privateGet(this, _e).delete(e);
    }
    clear() {
      __privateGet(this, _e).clear();
    }
  }, _t3 = new WeakMap(), _e = new WeakMap(), _a2);
  var KE = 100;
  var Xc = new la(KE);
  function ca(t6, e) {
    let s = Xc.get(t6);
    if (s !== void 0) return s;
    let r = e().then((n) => n, (n) => (Xc.delete(t6), Promise.reject(n)));
    return Xc.put(t6, r), r;
  }
  async function XE(t6) {
    if (!zt(t6, ["http:", "https:"])) return null;
    let e = Qc(t6);
    return e.set("Range", "bytes=0-0"), J.fetch(t6, { method: "GET", headers: e, cache: "no-store" });
  }
  function We(t6, e, s = {}) {
    let r = JSON.stringify([t6, e, s?.revision, s?.cache_dir, s?.local_files_only]);
    return ca(r, () => QE(t6, e, s));
  }
  async function QE(t6, e, s) {
    let r = await at(s?.cache_dir), { localPath: n, remoteURL: o, proposedCacheKey: i, validModelId: a } = Ct(t6, e, s, r), l = await Pt(r, n, i);
    if (l !== void 0 && typeof l != "string") {
      let c = l.headers.get("content-length"), p = l.headers.get("content-type");
      return { exists: true, size: c ? parseInt(c, 10) : void 0, contentType: p || void 0, fromCache: true };
    }
    if (J.allowLocalModels && !zt(n, ["http:", "https:"])) try {
      let p = await Tt(n);
      if (typeof p != "string" && p.status !== 404) {
        let u = p.headers.get("content-length"), _ = p.headers.get("content-type");
        return { exists: true, size: u ? parseInt(u, 10) : void 0, contentType: _ || void 0, fromCache: false };
      }
    } catch {
    }
    if (J.allowRemoteModels && !s.local_files_only && a) try {
      let c = await XE(o);
      if (c && c.status >= 200 && c.status < 300) {
        let p, u = c.headers.get("content-type");
        if (c.status === 206) {
          let _ = c.headers.get("content-range");
          if (_) {
            let d = _.match(/bytes \d+-\d+\/(\d+)/);
            d && (p = parseInt(d[1], 10));
          }
        } else if (c.status === 200) try {
          await c.body?.cancel();
        } catch {
        }
        if (p === void 0) {
          let _ = c.headers.get("content-length");
          p = _ ? parseInt(_, 10) : void 0;
        }
        return { exists: true, size: p, contentType: u || void 0, fromCache: false };
      }
    } catch (c) {
      F.warn(`Unable to fetch file metadata for "${o}": ${c}`);
    }
    return { exists: false, fromCache: false };
  }
  async function Tt(t6) {
    return J.useFS && !zt(t6, ["http:", "https:", "blob:"]) ? new Ot(t6 instanceof URL ? t6.protocol === "file:" ? t6.pathname : t6.toString() : t6) : J.fetch(t6, { headers: Qc(t6) });
  }
  function Qc(t6) {
    let e = typeof process < "u" && process?.release?.name === "node", s = new Headers();
    if (e) {
      let r = !!process.env?.TESTING_REMOTELY, n = J.version;
      if (s.set("User-Agent", `transformers.js/${n}; is_ci/${r};`), zt(t6, ["http:", "https:"], ["huggingface.co", "hf.co"])) {
        let i = process.env?.HF_TOKEN ?? process.env?.HF_ACCESS_TOKEN;
        i && s.set("Authorization", `Bearer ${i}`);
      }
    }
    return s;
  }
  function Ct(t6, e, s = {}, r = null) {
    let n = s.revision ?? "main", o = Cr(t6, e), i = y0(t6), a = i ? Cr(J.localModelPath, o) : o, l = Cr(J.remoteHost, J.remotePathTemplate.replaceAll("{model}", t6).replaceAll("{revision}", encodeURIComponent(n)), e), c = r instanceof Ps ? n === "main" ? o : Cr(t6, n, e) : l;
    return { requestURL: o, localPath: a, remoteURL: l, proposedCacheKey: c, validModelId: i };
  }
  async function Pt(t6, e, s) {
    if (t6) return await A0(t6, e, s);
  }
  async function YE(t6, e, s, r, n, o, i = {}) {
    if (await s.match(r) === void 0) if (o) {
      if (typeof n != "string") {
        let a = new Headers(n.headers);
        a.set("content-length", o.byteLength.toString()), await s.put(r, new Response(o, { headers: a })).catch((l) => {
          F.warn(`Unable to add response to browser cache: ${l}.`);
        });
      }
    } else {
      let a = i.progress_callback ? (l) => _t(i.progress_callback, { status: "progress", name: t6, file: e, ...l }) : void 0;
      await s.put(r, n, a);
    }
  }
  async function JE(t6, e, s = true, r = {}, n = false, o = null) {
    let { requestURL: i, localPath: a, remoteURL: l, proposedCacheKey: c, validModelId: p } = Ct(t6, e, r, o), u, _ = false, d;
    d = await Pt(o, a, c);
    let m = d !== void 0;
    if (m) u = c;
    else {
      if (J.allowLocalModels) if (zt(i, ["http:", "https:"])) {
        if (r.local_files_only) throw new Error(`\`local_files_only=true\`, but attempted to load a remote file from: ${i}.`);
        if (!J.allowRemoteModels) throw new Error(`\`env.allowRemoteModels=false\`, but attempted to load a remote file from: ${i}.`);
      } else try {
        d = await Tt(a), u = a;
      } catch (w) {
        F.warn(`Unable to load from local path "${a}": "${w}"`);
      }
      if (d === void 0 || typeof d != "string" && d.status === 404) {
        if (r.local_files_only || !J.allowRemoteModels) {
          if (s) throw Error(`\`local_files_only=true\` or \`env.allowRemoteModels=false\` and file was not found locally at "${a}".`);
          return null;
        }
        if (!p) throw Error(`Local file missing at "${a}" and download aborted due to invalid model ID "${t6}".`);
        if (d = await Tt(l), d.status !== 200) return b0(d.status, l, s);
        u = c;
      }
      _ = o && typeof Response < "u" && d instanceof Response && d.status === 200;
    }
    _t(r.progress_callback, { status: "download", name: t6, file: e });
    let f;
    if (!(K.IS_NODE_ENV && n)) {
      let x;
      if (typeof d != "string") if (!r.progress_callback) x = new Uint8Array(await d.arrayBuffer());
      else if (m && typeof navigator < "u" && /firefox/i.test(navigator.userAgent)) x = new Uint8Array(await d.arrayBuffer()), _t(r.progress_callback, { status: "progress", name: t6, file: e, progress: 100, loaded: x.length, total: x.length });
      else {
        let w, y = d.headers.get("content-length");
        if (y) w = parseInt(y, 10);
        else try {
          let b = await We(t6, e, r);
          b.size && (w = b.size);
        } catch {
        }
        x = await k0(d, (b) => {
          _t(r.progress_callback, { status: "progress", name: t6, file: e, ...b });
        }, w);
      }
      f = x;
    }
    if (_ && u && typeof d != "string" && await YE(t6, e, o, u, d, f, r), K.IS_NODE_ENV && n && r.progress_callback && typeof d != "string") {
      let x = parseInt(d.headers.get("content-length"), 10) || 0;
      _t(r.progress_callback, { status: "progress", name: t6, file: e, progress: 100, loaded: x, total: x });
    }
    if (_t(r.progress_callback, { status: "done", name: t6, file: e }), f) {
      if (!K.IS_NODE_ENV && n) throw new Error("Cannot return path in a browser environment.");
      return f;
    }
    if (d instanceof Ot) return d.filePath;
    let g = await o?.match(u);
    if (g instanceof Ot) return g.filePath;
    if (g instanceof Response) return new Uint8Array(await g.arrayBuffer());
    if (typeof g == "string") return g;
    throw new Error("Unable to get model file path or buffer.");
  }
  var pa = /* @__PURE__ */ new Map();
  async function Nr(t6, e, s = true, r = {}, n = false) {
    if (!J.allowLocalModels) {
      if (r.local_files_only) throw Error("Invalid configuration detected: local models are disabled (`env.allowLocalModels=false`) but you have requested to only use local models (`local_files_only=true`).");
      if (!J.allowRemoteModels) throw Error("Invalid configuration detected: both local and remote models are disabled. Fix by setting `env.allowLocalModels` or `env.allowRemoteModels` to `true`.");
    }
    _t(r.progress_callback, { status: "initiate", name: t6, file: e });
    let o = `${t6}::${e}`, i = pa.get(o);
    if (!i) {
      let a = await at(r?.cache_dir);
      i = JE(t6, e, s, r, n, a).then((l) => (pa.delete(o), l), (l) => {
        throw pa.delete(o), l;
      }), pa.set(o, i);
    }
    return await i;
  }
  async function Lr(t6, e, s = true, r = {}) {
    let n = await Nr(t6, e, s, r, false);
    return n === null ? null : new TextDecoder("utf-8").decode(n);
  }
  async function Oe(t6, e, s = true, r = {}) {
    let n = await Lr(t6, e, s, r);
    return n === null ? {} : JSON.parse(n);
  }
  function S0(t6, [e, s, r], [n, o], i = "bilinear", a = false) {
    let l = o / r, c = n / s, p = new t6.constructor(n * o * e), u = s * r, _ = n * o;
    for (let d = 0; d < n; ++d) for (let m = 0; m < o; ++m) {
      let f = d * o + m, g = (m + 0.5) / l - 0.5, x = (d + 0.5) / c - 0.5, w = Math.floor(g), y = Math.floor(x), b = Math.min(w + 1, r - 1), v = Math.min(y + 1, s - 1);
      w = Math.max(w, 0), y = Math.max(y, 0);
      let k = g - w, S = x - y, I = (1 - k) * (1 - S), $ = k * (1 - S), C = (1 - k) * S, q = k * S, D = y * r, B = v * r, H = D + w, V = D + b, Z = B + w, R = B + b;
      for (let A = 0; A < e; ++A) {
        let O = A * u;
        p[A * _ + f] = I * t6[O + H] + $ * t6[O + V] + C * t6[O + Z] + q * t6[O + R];
      }
    }
    return p;
  }
  function O0(t6, e, s) {
    let r = new Array(s.length), n = new Array(s.length);
    for (let a = s.length - 1, l = 1; a >= 0; --a) n[a] = l, r[a] = e[s[a]], l *= r[a];
    let o = s.map((a, l) => n[s.indexOf(l)]), i = new t6.constructor(t6.length);
    for (let a = 0; a < t6.length; ++a) {
      let l = 0;
      for (let c = e.length - 1, p = a; c >= 0; --c) l += p % e[c] * o[c], p = Math.floor(p / e[c]);
      i[l] = t6[a];
    }
    return [i, r];
  }
  function fe(t6) {
    let e = de(t6)[0], s = t6.map((o) => Math.exp(o - e)), r = s.reduce((o, i) => o + i, 0);
    return s.map((o) => o / r);
  }
  function Jc(t6) {
    let e = de(t6)[0], s = 0;
    for (let o = 0; o < t6.length; ++o) s += Math.exp(t6[o] - e);
    let r = Math.log(s);
    return t6.map((o) => o - e - r);
  }
  function $r(t6) {
    if (t6.length === 0) throw Error("Array must not be empty");
    let e = t6[0], s = 0;
    for (let r = 1; r < t6.length; ++r) t6[r] < e && (e = t6[r], s = r);
    return [e, s];
  }
  function de(t6) {
    if (t6.length === 0) throw Error("Array must not be empty");
    let e = t6[0], s = 0;
    for (let r = 1; r < t6.length; ++r) t6[r] > e && (e = t6[r], s = r);
    return [e, s];
  }
  function z0(t6) {
    return t6 > 0 && (t6 & t6 - 1) === 0;
  }
  var ua = class {
    constructor(e) {
      if (this.size = e | 0, this.size <= 1 || !z0(this.size)) throw new Error("FFT size must be a power of two larger than 1");
      this._csize = e << 1, this.table = new Float64Array(this.size * 2);
      for (let r = 0; r < this.table.length; r += 2) {
        let n = Math.PI * r / this.size;
        this.table[r] = Math.cos(n), this.table[r + 1] = -Math.sin(n);
      }
      let s = 0;
      for (let r = 1; this.size > r; r <<= 1) ++s;
      this._width = s % 2 === 0 ? s - 1 : s, this._bitrev = new Int32Array(1 << this._width);
      for (let r = 0; r < this._bitrev.length; ++r) {
        this._bitrev[r] = 0;
        for (let n = 0; n < this._width; n += 2) {
          let o = this._width - n - 2;
          this._bitrev[r] |= (r >>> n & 3) << o;
        }
      }
    }
    createComplexArray() {
      return new Float64Array(this._csize);
    }
    fromComplexArray(e, s) {
      let r = s || new Array(e.length >>> 1);
      for (let n = 0; n < e.length; n += 2) r[n >>> 1] = e[n];
      return r;
    }
    toComplexArray(e, s) {
      let r = s || this.createComplexArray();
      for (let n = 0; n < r.length; n += 2) r[n] = e[n >>> 1], r[n + 1] = 0;
      return r;
    }
    transform(e, s) {
      if (e === s) throw new Error("Input and output buffers must be different");
      this._transform4(e, s, 1);
    }
    realTransform(e, s) {
      if (e === s) throw new Error("Input and output buffers must be different");
      this._realTransform4(e, s, 1);
    }
    inverseTransform(e, s) {
      if (e === s) throw new Error("Input and output buffers must be different");
      this._transform4(e, s, -1);
      for (let r = 0; r < e.length; ++r) e[r] /= this.size;
    }
    _transform4(e, s, r) {
      let n = this._csize, i = 1 << this._width, a = n / i << 1, l, c, p = this._bitrev;
      if (a === 4) for (l = 0, c = 0; l < n; l += a, ++c) {
        let _ = p[c];
        this._singleTransform2(s, e, l, _, i);
      }
      else for (l = 0, c = 0; l < n; l += a, ++c) {
        let _ = p[c];
        this._singleTransform4(s, e, l, _, i, r);
      }
      let u = this.table;
      for (i >>= 2; i >= 2; i >>= 2) {
        a = n / i << 1;
        let _ = a >>> 2;
        for (l = 0; l < n; l += a) {
          let d = l + _ - 1;
          for (let m = l, f = 0; m < d; m += 2, f += i) {
            let g = m, x = g + _, w = x + _, y = w + _, b = e[g], v = e[g + 1], k = e[x], S = e[x + 1], I = e[w], $ = e[w + 1], C = e[y], q = e[y + 1], D = u[f], B = r * u[f + 1], H = k * D - S * B, V = k * B + S * D, Z = u[2 * f], R = r * u[2 * f + 1], A = I * Z - $ * R, O = I * R + $ * Z, z = u[3 * f], G = r * u[3 * f + 1], ee = C * z - q * G, Le = C * G + q * z, re = b + A, ut = v + O, He = b - A, Er = v - O, Ms = H + ee, Ss = V + Le, Ar = r * (H - ee), Mr = r * (V - Le);
            e[g] = re + Ms, e[g + 1] = ut + Ss, e[x] = He + Mr, e[x + 1] = Er - Ar, e[w] = re - Ms, e[w + 1] = ut - Ss, e[y] = He - Mr, e[y + 1] = Er + Ar;
          }
        }
      }
    }
    _singleTransform2(e, s, r, n, o) {
      let i = e[n], a = e[n + 1], l = e[n + o], c = e[n + o + 1];
      s[r] = i + l, s[r + 1] = a + c, s[r + 2] = i - l, s[r + 3] = a - c;
    }
    _singleTransform4(e, s, r, n, o, i) {
      let a = o * 2, l = o * 3, c = e[n], p = e[n + 1], u = e[n + o], _ = e[n + o + 1], d = e[n + a], m = e[n + a + 1], f = e[n + l], g = e[n + l + 1], x = c + d, w = p + m, y = c - d, b = p - m, v = u + f, k = _ + g, S = i * (u - f), I = i * (_ - g);
      s[r] = x + v, s[r + 1] = w + k, s[r + 2] = y + I, s[r + 3] = b - S, s[r + 4] = x - v, s[r + 5] = w - k, s[r + 6] = y - I, s[r + 7] = b + S;
    }
    _realTransform4(e, s, r) {
      let n = this._csize, i = 1 << this._width, a = n / i << 1, l, c, p = this._bitrev;
      if (a === 4) for (l = 0, c = 0; l < n; l += a, ++c) {
        let d = p[c];
        this._singleRealTransform2(s, e, l, d >>> 1, i >>> 1);
      }
      else for (l = 0, c = 0; l < n; l += a, ++c) {
        let d = p[c];
        this._singleRealTransform4(s, e, l, d >>> 1, i >>> 1, r);
      }
      let u = this.table;
      for (i >>= 2; i >= 2; i >>= 2) {
        a = n / i << 1;
        let d = a >>> 1, m = d >>> 1, f = m >>> 1;
        for (l = 0; l < n; l += a) for (let g = 0, x = 0; g <= f; g += 2, x += i) {
          let w = l + g, y = w + m, b = y + m, v = b + m, k = e[w], S = e[w + 1], I = e[y], $ = e[y + 1], C = e[b], q = e[b + 1], D = e[v], B = e[v + 1], H = k, V = S, Z = u[x], R = r * u[x + 1], A = I * Z - $ * R, O = I * R + $ * Z, z = u[2 * x], G = r * u[2 * x + 1], ee = C * z - q * G, Le = C * G + q * z, re = u[3 * x], ut = r * u[3 * x + 1], He = D * re - B * ut, Er = D * ut + B * re, Ms = H + ee, Ss = V + Le, Ar = H - ee, Mr = V - Le, Lc = A + He, $c = O + Er, Oy = r * (A - He), Iy = r * (O - Er);
          if (e[w] = Ms + Lc, e[w + 1] = Ss + $c, e[y] = Ar + Iy, e[y + 1] = Mr - Oy, g === 0) {
            e[b] = Ms - Lc, e[b + 1] = Ss - $c;
            continue;
          }
          if (g === f) continue;
          let zy = l + m - g, Ty = l + d - g;
          e[zy] = Ar - r * Iy, e[zy + 1] = -Mr - r * Oy, e[Ty] = Ms - r * Lc, e[Ty + 1] = -Ss + r * $c;
        }
      }
      let _ = n >>> 1;
      for (let d = 2; d < _; d += 2) e[n - d] = e[d], e[n - d + 1] = -e[d + 1];
    }
    _singleRealTransform2(e, s, r, n, o) {
      let i = e[n], a = e[n + o];
      s[r] = i + a, s[r + 1] = 0, s[r + 2] = i - a, s[r + 3] = 0;
    }
    _singleRealTransform4(e, s, r, n, o, i) {
      let a = o * 2, l = o * 3, c = e[n], p = e[n + o], u = e[n + a], _ = e[n + l], d = c + u, m = c - u, f = p + _, g = i * (p - _);
      s[r] = d + f, s[r + 1] = 0, s[r + 2] = m, s[r + 3] = -g, s[r + 4] = d - f, s[r + 5] = 0, s[r + 6] = m, s[r + 7] = g;
    }
  };
  var Yc = class {
    constructor(e) {
      let s = 2 * (e - 1), r = 2 * (2 * e - 1), n = 2 ** Math.ceil(Math.log2(r));
      this.bufferSize = n, this._a = s;
      let o = new Float64Array(r), i = new Float64Array(n);
      this._chirpBuffer = new Float64Array(n), this._buffer1 = new Float64Array(n), this._buffer2 = new Float64Array(n), this._outBuffer1 = new Float64Array(n), this._outBuffer2 = new Float64Array(n);
      let a = -2 * Math.PI / e, l = Math.cos(a), c = Math.sin(a);
      for (let p = 0; p < r >> 1; ++p) {
        let u = (p + 1 - e) ** 2 / 2, _ = Math.sqrt(l ** 2 + c ** 2) ** u, d = u * Math.atan2(c, l), m = 2 * p;
        o[m] = _ * Math.cos(d), o[m + 1] = _ * Math.sin(d), i[m] = o[m], i[m + 1] = -o[m + 1];
      }
      this._slicedChirpBuffer = o.subarray(s, r), this._f = new ua(n >> 1), this._f.transform(this._chirpBuffer, i);
    }
    _transform(e, s, r) {
      let n = this._buffer1, o = this._buffer2, i = this._outBuffer1, a = this._outBuffer2, l = this._chirpBuffer, c = this._slicedChirpBuffer, p = this._a;
      if (r) for (let u = 0; u < c.length; u += 2) {
        let _ = u + 1, d = u >> 1, m = s[d];
        n[u] = m * c[u], n[_] = m * c[_];
      }
      else for (let u = 0; u < c.length; u += 2) {
        let _ = u + 1;
        n[u] = s[u] * c[u] - s[_] * c[_], n[_] = s[u] * c[_] + s[_] * c[u];
      }
      this._f.transform(i, n);
      for (let u = 0; u < l.length; u += 2) {
        let _ = u + 1;
        o[u] = i[u] * l[u] - i[_] * l[_], o[_] = i[u] * l[_] + i[_] * l[u];
      }
      this._f.inverseTransform(a, o);
      for (let u = 0; u < a.length; u += 2) {
        let _ = a[u + p], d = a[u + p + 1], m = c[u], f = c[u + 1];
        e[u] = _ * m - d * f, e[u + 1] = _ * f + d * m;
      }
    }
    transform(e, s) {
      this._transform(e, s, false);
    }
    realTransform(e, s) {
      this._transform(e, s, true);
    }
  };
  var _a3 = class {
    constructor(e) {
      this.fft_length = e, this.isPowerOfTwo = z0(e), this.isPowerOfTwo ? (this.fft = new ua(e), this.outputBufferSize = 2 * e) : (this.fft = new Yc(e), this.outputBufferSize = this.fft.bufferSize);
    }
    realTransform(e, s) {
      this.fft.realTransform(e, s);
    }
    transform(e, s) {
      this.fft.transform(e, s);
    }
  };
  function T0(t6, e) {
    if (e % 2 === 0 || e <= 0) throw new Error("Window size must be a positive odd number");
    let s = new t6.constructor(t6.length), r = new t6.constructor(e), n = Math.floor(e / 2);
    for (let o = 0; o < t6.length; ++o) {
      let i = 0;
      for (let a = -n; a <= n; ++a) {
        let l = o + a;
        l < 0 ? l = Math.abs(l) : l >= t6.length && (l = 2 * (t6.length - 1) - l), r[i++] = t6[l];
      }
      r.sort(), s[o] = r[n];
    }
    return s;
  }
  function os(t6, e) {
    let s = Math.pow(10, e);
    return Math.round(t6 * s) / s;
  }
  function C0(t6) {
    let e = Math.round(t6);
    return Math.abs(t6) % 1 === 0.5 ? e % 2 === 0 ? e : e - 1 : e;
  }
  function P0(t6) {
    let e = t6.length, s = t6[0].length, r = [e + 1, s + 1], n = Array.from({ length: r[0] }, () => Array(r[1]).fill(1 / 0));
    n[0][0] = 0;
    let o = Array.from({ length: r[0] }, () => Array(r[1]).fill(-1));
    for (let p = 1; p < r[1]; ++p) for (let u = 1; u < r[0]; ++u) {
      let _ = n[u - 1][p - 1], d = n[u - 1][p], m = n[u][p - 1], f, g;
      _ < d && _ < m ? (f = _, g = 0) : d < _ && d < m ? (f = d, g = 1) : (f = m, g = 2), n[u][p] = t6[u - 1][p - 1] + f, o[u][p] = g;
    }
    for (let p = 0; p < r[1]; ++p) o[0][p] = 2;
    for (let p = 0; p < r[0]; ++p) o[p][0] = 1;
    let i = e, a = s, l = [], c = [];
    for (; i > 0 || a > 0; ) switch (l.push(i - 1), c.push(a - 1), o[i][a]) {
      case 0:
        --i, --a;
        break;
      case 1:
        --i;
        break;
      case 2:
        --a;
        break;
      default:
        throw new Error(`Internal error in dynamic time warping. Unexpected trace[${i}, ${a}]. Please file a bug report.`);
    }
    return l.reverse(), c.reverse(), [l, c];
  }
  var N0 = /* @__PURE__ */ (function() {
    let t6 = null;
    return function(e) {
      if (!t6) {
        t6 = new Float32Array(65536);
        let o = new ArrayBuffer(4), i = new Uint32Array(o), a = new Float32Array(o);
        for (let l = 0; l < t6.length; ++l) {
          let c = 0, p = (l & 32768) << 16, u = (l & 31744) >> 10, _ = l & 1023;
          if (u === 31) c = p | 2139095040 | _ << 13;
          else if (u === 0) if (_ === 0) c = p;
          else {
            let d = 113;
            for (; (_ & 1024) === 0; ) _ <<= 1, --d;
            _ &= -1025, c = p | d << 23 | _ << 13;
          }
          else c = p | u + 112 << 23 | _ << 13;
          i[0] = c, t6[l] = a[0];
        }
      }
      let s = e.length, r = t6, n = new Float32Array(s);
      for (let o = 0; o < s; ++o) n[o] = r[e[o]];
      return n;
    };
  })();
  var Zc = {};
  Os(Zc, { default: () => eA });
  var eA = {};
  async function L0(t6) {
    let e = t6.split("/").pop(), s;
    try {
      if (s = await at(), s) {
        let n = await s.match(t6);
        if (n) return n;
      }
    } catch (n) {
      F.warn(`Failed to load ${e} from cache:`, n);
    }
    let r = await J.fetch(t6);
    if (!r.ok) throw new Error(`Failed to fetch ${e}: ${r.status} ${r.statusText}`);
    if (s) try {
      await s.put(t6, r.clone());
    } catch (n) {
      F.warn(`Failed to cache ${e}:`, n);
    }
    return r;
  }
  async function $0(t6) {
    let e = await L0(t6);
    if (!e || typeof e == "string") return null;
    try {
      return await e.arrayBuffer();
    } catch (s) {
      return F.warn("Failed to read WASM binary:", s), null;
    }
  }
  async function F0(t6) {
    if (K.IS_SERVICE_WORKER_ENV || K.IS_CHROME_AVAILABLE) return t6;
    let e = await L0(t6);
    if (!e || typeof e == "string") return null;
    try {
      let s = await e.text();
      s = s.replaceAll("globalThis.process?.versions?.node", "false");
      let r = new Blob([s], { type: "text/javascript" });
      return URL.createObjectURL(r);
    } catch (s) {
      return F.warn("Failed to read WASM factory:", s), null;
    }
  }
  var sA = Object.freeze({ auto: null, gpu: null, cpu: "cpu", wasm: "wasm", webgpu: "webgpu", cuda: "cuda", dml: "dml", coreml: "coreml", webnn: { name: "webnn", deviceType: "cpu" }, "webnn-npu": { name: "webnn", deviceType: "npu" }, "webnn-gpu": { name: "webnn", deviceType: "gpu" }, "webnn-cpu": { name: "webnn", deviceType: "cpu" } });
  function j0(t6) {
    return t6 <= Ge.DEBUG ? 0 : t6 <= Ge.INFO ? 2 : t6 <= Ge.WARNING || t6 <= Ge.ERROR ? 3 : 4;
  }
  var rA = { 0: "verbose", 1: "info", 2: "warning", 3: "error", 4: "fatal" };
  var et = [];
  var ep;
  var Ls;
  var R0 = /* @__PURE__ */ Symbol.for("onnxruntime");
  if (R0 in globalThis) Ls = globalThis[R0];
  else if (K.IS_NODE_ENV) {
    switch (Ls = Zc, process.platform) {
      case "win32":
        et.push("dml");
        break;
      case "linux":
        process.arch === "x64" && et.push("cuda");
        break;
      case "darwin":
        et.push("coreml");
        break;
    }
    et.push("webgpu"), et.push("cpu"), ep = ["cpu"];
  } else Ls = tA, K.IS_WEBNN_AVAILABLE && et.push("webnn-npu", "webnn-gpu", "webnn-cpu", "webnn"), K.IS_WEBGPU_AVAILABLE && et.push("webgpu"), et.push("wasm"), ep = ["wasm"];
  var nA = Ls.InferenceSession;
  function B0(t6 = null) {
    if (!t6) return ep;
    switch (t6) {
      case "auto":
        return et;
      case "gpu":
        return et.filter((e) => ["webgpu", "cuda", "dml", "webnn-gpu"].includes(e));
    }
    if (et.includes(t6)) return [sA[t6] ?? t6];
    throw new Error(`Unsupported device: "${t6}". Should be one of: ${et.join(", ")}.`);
  }
  var D0 = Promise.resolve();
  var Ns = null;
  async function oA() {
    if (Ns) return Ns;
    if (!(J.useWasmCache && typeof Te?.wasm?.wasmPaths == "object" && Te?.wasm?.wasmPaths?.wasm && Te?.wasm?.wasmPaths?.mjs)) {
      if (K.IS_DENO_WEB_RUNTIME) throw new Error("env.useWasmCache=false is not supported in Deno's web runtime. Remove the useWasmCache override.");
      return Ns = Promise.resolve(), Ns;
    }
    return Ns = (async () => {
      let e = Te.wasm.wasmPaths, s = false;
      await Promise.all([e.wasm && !Hc(e.wasm) ? (async () => {
        try {
          let r = await $0(Kc(e.wasm));
          r && (Te.wasm.wasmBinary = r, s = true);
        } catch (r) {
          F.warn("Failed to pre-load WASM binary:", r);
        }
      })() : Promise.resolve(), e.mjs && !Hc(e.mjs) ? (async () => {
        try {
          let r = await F0(Kc(e.mjs));
          r && (Te.wasm.wasmPaths.mjs = r);
        } catch (r) {
          F.warn("Failed to pre-load WASM factory:", r);
        }
      })() : Promise.resolve()]), s || (Te.wasm.wasmPaths.mjs = e.mjs);
    })(), Ns;
  }
  async function da(t6, e, s) {
    await oA();
    let r = j0(J.logLevel ?? Ge.WARNING), n = () => nA.create(t6, { logSeverityLevel: r, ...e }), o = await (K.IS_WEB_ENV ? D0 = D0.then(n) : n());
    return o.config = s, o;
  }
  var q0 = Promise.resolve();
  async function ma(t6, e) {
    let s = () => t6.run(e);
    return K.IS_WEB_ENV ? q0 = q0.then(s) : s();
  }
  function fa(t6) {
    return t6 instanceof Ls.Tensor;
  }
  var Te = Ls?.env;
  function Fr() {
    return Te?.wasm?.proxy;
  }
  if (Te) {
    let t6 = function(e) {
      let s = j0(e);
      Te.logLevel = rA[s];
    };
    if (Te.wasm) {
      if (!(typeof ServiceWorkerGlobalScope < "u" && self instanceof ServiceWorkerGlobalScope) && Te.versions?.web && !Te.wasm.wasmPaths) {
        let e = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${Te.versions.web}/dist/`;
        Te.wasm.wasmPaths = K.IS_SAFARI ? { mjs: `${e}ort-wasm-simd-threaded.mjs`, wasm: `${e}ort-wasm-simd-threaded.wasm` } : { mjs: `${e}ort-wasm-simd-threaded.asyncify.mjs`, wasm: `${e}ort-wasm-simd-threaded.asyncify.wasm` };
      }
      Te.wasm.proxy = false;
    }
    Te.webgpu && (Te.webgpu.powerPreference = "high-performance"), t6(J.logLevel ?? Ge.WARNING), J.backends.onnx = { ...Te, setLogLevel: t6 };
  }
  var Nt = async (t6, e, s) => {
    let r = await da(new Uint8Array(t6), e);
    return (async (n) => {
      let o = Fr(), i = Object.fromEntries(Object.entries(n).map(([l, c]) => [l, (o ? c.clone() : c).ort_tensor])), a = await ma(r, i);
      return Array.isArray(s) ? s.map((l) => new E(a[l])) : new E(a[s]);
    });
  };
  var _a4;
  var ft = (_a4 = class {
    static get nearest_interpolate_4d() {
      return this._nearest_interpolate_4d || (this._nearest_interpolate_4d = Nt([8, 10, 18, 0, 58, 129, 1, 10, 41, 10, 1, 120, 10, 0, 10, 0, 10, 1, 115, 18, 1, 121, 34, 6, 82, 101, 115, 105, 122, 101, 42, 18, 10, 4, 109, 111, 100, 101, 34, 7, 110, 101, 97, 114, 101, 115, 116, 160, 1, 3, 18, 1, 114, 90, 31, 10, 1, 120, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 99, 10, 3, 18, 1, 104, 10, 3, 18, 1, 119, 90, 15, 10, 1, 115, 18, 10, 10, 8, 8, 7, 18, 4, 10, 2, 8, 4, 98, 31, 10, 1, 121, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 99, 10, 3, 18, 1, 104, 10, 3, 18, 1, 119, 66, 2, 16, 21], this.session_options, "y")), this._nearest_interpolate_4d;
    }
    static get bilinear_interpolate_4d() {
      return this._bilinear_interpolate_4d || (this._bilinear_interpolate_4d = Nt([8, 9, 18, 0, 58, 128, 1, 10, 40, 10, 1, 120, 10, 0, 10, 0, 10, 1, 115, 18, 1, 121, 34, 6, 82, 101, 115, 105, 122, 101, 42, 17, 10, 4, 109, 111, 100, 101, 34, 6, 108, 105, 110, 101, 97, 114, 160, 1, 3, 18, 1, 114, 90, 31, 10, 1, 120, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 99, 10, 3, 18, 1, 104, 10, 3, 18, 1, 119, 90, 15, 10, 1, 115, 18, 10, 10, 8, 8, 7, 18, 4, 10, 2, 8, 4, 98, 31, 10, 1, 121, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 99, 10, 3, 18, 1, 104, 10, 3, 18, 1, 119, 66, 2, 16, 20], this.session_options, "y")), this._bilinear_interpolate_4d;
    }
    static get bicubic_interpolate_4d() {
      return this._bicubic_interpolate_4d || (this._bicubic_interpolate_4d = Nt([8, 9, 18, 0, 58, 127, 10, 39, 10, 1, 120, 10, 0, 10, 0, 10, 1, 115, 18, 1, 121, 34, 6, 82, 101, 115, 105, 122, 101, 42, 16, 10, 4, 109, 111, 100, 101, 34, 5, 99, 117, 98, 105, 99, 160, 1, 3, 18, 1, 114, 90, 31, 10, 1, 120, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 99, 10, 3, 18, 1, 104, 10, 3, 18, 1, 119, 90, 15, 10, 1, 115, 18, 10, 10, 8, 8, 7, 18, 4, 10, 2, 8, 4, 98, 31, 10, 1, 121, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 99, 10, 3, 18, 1, 104, 10, 3, 18, 1, 119, 66, 2, 16, 20], this.session_options, "y")), this._bicubic_interpolate_4d;
    }
    static get matmul() {
      return this._matmul || (this._matmul = Nt([8, 9, 18, 0, 58, 55, 10, 17, 10, 1, 97, 10, 1, 98, 18, 1, 99, 34, 6, 77, 97, 116, 77, 117, 108, 18, 1, 114, 90, 9, 10, 1, 97, 18, 4, 10, 2, 8, 1, 90, 9, 10, 1, 98, 18, 4, 10, 2, 8, 1, 98, 9, 10, 1, 99, 18, 4, 10, 2, 8, 1, 66, 2, 16, 20], this.session_options, "c")), this._matmul;
    }
    static get stft() {
      return this._stft || (this._stft = Nt([8, 7, 18, 0, 58, 148, 1, 10, 38, 10, 1, 115, 10, 1, 106, 10, 1, 119, 10, 1, 108, 18, 1, 111, 34, 4, 83, 84, 70, 84, 42, 15, 10, 8, 111, 110, 101, 115, 105, 100, 101, 100, 24, 1, 160, 1, 2, 18, 1, 115, 90, 26, 10, 1, 115, 18, 21, 10, 19, 8, 1, 18, 15, 10, 3, 18, 1, 98, 10, 3, 18, 1, 115, 10, 3, 18, 1, 99, 90, 11, 10, 1, 106, 18, 6, 10, 4, 8, 7, 18, 0, 90, 16, 10, 1, 119, 18, 11, 10, 9, 8, 1, 18, 5, 10, 3, 18, 1, 119, 90, 11, 10, 1, 108, 18, 6, 10, 4, 8, 7, 18, 0, 98, 31, 10, 1, 111, 18, 26, 10, 24, 8, 1, 18, 20, 10, 3, 18, 1, 98, 10, 3, 18, 1, 102, 10, 3, 18, 1, 100, 10, 3, 18, 1, 99, 66, 2, 16, 17], this.session_options, "o")), this._stft;
    }
    static get rfft() {
      return this._rfft || (this._rfft = Nt([8, 9, 18, 0, 58, 97, 10, 33, 10, 1, 120, 10, 0, 10, 1, 97, 18, 1, 121, 34, 3, 68, 70, 84, 42, 15, 10, 8, 111, 110, 101, 115, 105, 100, 101, 100, 24, 1, 160, 1, 2, 18, 1, 100, 90, 21, 10, 1, 120, 18, 16, 10, 14, 8, 1, 18, 10, 10, 3, 18, 1, 115, 10, 3, 18, 1, 99, 90, 11, 10, 1, 97, 18, 6, 10, 4, 8, 7, 18, 0, 98, 21, 10, 1, 121, 18, 16, 10, 14, 8, 1, 18, 10, 10, 3, 18, 1, 115, 10, 3, 18, 1, 99, 66, 2, 16, 20], this.session_options, "y")), this._rfft;
    }
    static get top_k() {
      return this._top_k || (this._top_k = Nt([8, 10, 18, 0, 58, 73, 10, 18, 10, 1, 120, 10, 1, 107, 18, 1, 118, 18, 1, 105, 34, 4, 84, 111, 112, 75, 18, 1, 116, 90, 9, 10, 1, 120, 18, 4, 10, 2, 8, 1, 90, 15, 10, 1, 107, 18, 10, 10, 8, 8, 7, 18, 4, 10, 2, 8, 1, 98, 9, 10, 1, 118, 18, 4, 10, 2, 8, 1, 98, 9, 10, 1, 105, 18, 4, 10, 2, 8, 7, 66, 2, 16, 21], this.session_options, ["v", "i"])), this._top_k;
    }
    static get slice() {
      return this._slice || (this._slice = Nt([8, 7, 18, 0, 58, 96, 10, 25, 10, 1, 120, 10, 1, 115, 10, 1, 101, 10, 1, 97, 10, 1, 116, 18, 1, 121, 34, 5, 83, 108, 105, 99, 101, 18, 1, 114, 90, 9, 10, 1, 120, 18, 4, 10, 2, 8, 1, 90, 9, 10, 1, 115, 18, 4, 10, 2, 8, 7, 90, 9, 10, 1, 101, 18, 4, 10, 2, 8, 7, 90, 9, 10, 1, 97, 18, 4, 10, 2, 8, 7, 90, 9, 10, 1, 116, 18, 4, 10, 2, 8, 7, 98, 9, 10, 1, 121, 18, 4, 10, 2, 8, 1, 66, 2, 16, 13], this.session_options, "y")), this._slice;
    }
  }, __publicField(_a4, "session_options", {}), _a4);
  var G0 = Object.freeze({ auto: "auto", gpu: "gpu", cpu: "cpu", wasm: "wasm", webgpu: "webgpu", cuda: "cuda", dml: "dml", coreml: "coreml", webnn: "webnn", "webnn-npu": "webnn-npu", "webnn-gpu": "webnn-gpu", "webnn-cpu": "webnn-cpu" });
  var tp = K.IS_NODE_ENV ? "cpu" : "wasm";
  function ha(t6, e, { warn: s } = {}) {
    return t6 ? typeof t6 == "string" ? t6 : t6.hasOwnProperty(e) ? t6[e] : (s && s(`device not specified for "${e}". Using the default device (${tp}).`), tp) : tp;
  }
  var H0 = /* @__PURE__ */ (function() {
    let t6;
    return async function() {
      if (t6 === void 0) if (!K.IS_WEBGPU_AVAILABLE) t6 = false;
      else try {
        t6 = (await navigator.gpu.requestAdapter()).features.has("shader-f16");
      } catch {
        t6 = false;
      }
      return t6;
    };
  })();
  var De = Object.freeze({ auto: "auto", fp32: "fp32", fp16: "fp16", q8: "q8", int8: "int8", uint8: "uint8", q4: "q4", bnb4: "bnb4", q4f16: "q4f16" });
  var W0 = De.fp32;
  var V0 = Object.freeze({ [G0.wasm]: De.q8 });
  var Lt = Object.freeze({ [De.fp32]: "", [De.fp16]: "_fp16", [De.int8]: "_int8", [De.uint8]: "_uint8", [De.q8]: "_quantized", [De.q4]: "_q4", [De.q4f16]: "_q4f16", [De.bnb4]: "_bnb4" });
  function ga(t6, e, s, { configDtype: r = null, warn: n } = {}) {
    let o, i = false;
    t6 && typeof t6 != "string" ? t6.hasOwnProperty(e) ? o = t6[e] : (o = null, i = true) : o = t6;
    let a;
    if (o === De.auto) {
      if (r) {
        let l = typeof r == "string" ? r : r?.[e];
        if (l && l !== De.auto && De.hasOwnProperty(l)) return l;
      }
      a = V0[s] ?? W0;
    } else o && De.hasOwnProperty(o) ? a = o : a = V0[s] ?? W0;
    return i && n && n(`dtype not specified for "${e}". Using the default dtype (${a}) for this device (${s}).`), a;
  }
  var bt = Object.freeze({ float32: Float32Array, float16: typeof Float16Array < "u" ? Float16Array : Uint16Array, float64: Float64Array, string: Array, int8: Int8Array, uint8: Uint8Array, int16: Int16Array, uint16: Uint16Array, int32: Int32Array, uint32: Uint32Array, int64: BigInt64Array, uint64: BigUint64Array, bool: Uint8Array, uint4: Uint8Array, int4: Int8Array });
  var E = class t2 {
    constructor(...e) {
      __publicField(this, "ort_tensor");
      return fa(e[0]) ? this.ort_tensor = e[0] : this.ort_tensor = new import_onnxruntime_common.Tensor(e[0], e[1], e[2]), new Proxy(this, { get: (s, r) => {
        if (typeof r == "string") {
          let n = Number(r);
          if (Number.isInteger(n)) return s._getitem(n);
        }
        return s[r];
      }, set: (s, r, n) => s[r] = n });
    }
    get dims() {
      return this.ort_tensor.dims;
    }
    set dims(e) {
      this.ort_tensor.dims = e;
    }
    get type() {
      return this.ort_tensor.type;
    }
    get data() {
      return this.ort_tensor.data;
    }
    get size() {
      return this.ort_tensor.size;
    }
    get location() {
      return this.ort_tensor.location;
    }
    dispose() {
      this.ort_tensor.dispose();
    }
    *[Symbol.iterator]() {
      let [e, ...s] = this.dims;
      if (s.length > 0) {
        let r = s.reduce((n, o) => n * o);
        for (let n = 0; n < e; ++n) yield this._subarray(n, r, s);
      } else yield* this.data;
    }
    _getitem(e) {
      let [s, ...r] = this.dims;
      if (e = ht(e, s), r.length > 0) {
        let n = r.reduce((o, i) => o * i);
        return this._subarray(e, n, r);
      } else return new t2(this.type, [this.data[e]], r);
    }
    indexOf(e) {
      let s = this.data;
      for (let r = 0; r < s.length; ++r) if (s[r] == e) return r;
      return -1;
    }
    _subarray(e, s, r) {
      let n = e * s, o = (e + 1) * s, i = "subarray" in this.data ? this.data.subarray(n, o) : this.data.slice(n, o);
      return new t2(this.type, i, r);
    }
    item() {
      let e = this.data;
      if (e.length !== 1) throw new Error(`a Tensor with ${e.length} elements cannot be converted to Scalar`);
      return e[0];
    }
    tolist() {
      return iA(this.data, this.dims);
    }
    sigmoid() {
      return this.clone().sigmoid_();
    }
    sigmoid_() {
      let e = this.data;
      for (let s = 0; s < e.length; ++s) e[s] = 1 / (1 + Math.exp(-e[s]));
      return this;
    }
    map(e) {
      return this.clone().map_(e);
    }
    map_(e) {
      let s = this.data;
      for (let r = 0; r < s.length; ++r) s[r] = e(s[r], r, s);
      return this;
    }
    mul(e) {
      return this.clone().mul_(e);
    }
    mul_(e) {
      let s = this.data;
      for (let r = 0; r < s.length; ++r) s[r] *= e;
      return this;
    }
    div(e) {
      return this.clone().div_(e);
    }
    div_(e) {
      let s = this.data;
      for (let r = 0; r < s.length; ++r) s[r] /= e;
      return this;
    }
    add(e) {
      return this.clone().add_(e);
    }
    add_(e) {
      let s = this.data;
      for (let r = 0; r < s.length; ++r) s[r] += e;
      return this;
    }
    sub(e) {
      return this.clone().sub_(e);
    }
    sub_(e) {
      let s = this.data;
      for (let r = 0; r < s.length; ++r) s[r] -= e;
      return this;
    }
    clone() {
      return new t2(this.type, this.data.slice(), this.dims.slice());
    }
    slice(...e) {
      let s = [], r = [];
      for (let p = 0; p < this.dims.length; ++p) {
        let u = e[p];
        if (u == null) r.push([0, this.dims[p]]), s.push(this.dims[p]);
        else if (typeof u == "number") u = ht(u, this.dims[p], p), r.push([u, u + 1]);
        else if (Array.isArray(u) && u.length === 2) {
          let [_, d] = u;
          if (_ = _ === null ? 0 : ht(_, this.dims[p], p, false), d = d === null ? this.dims[p] : ht(d, this.dims[p], p, false), _ > d) throw new Error(`Invalid slice: ${u}`);
          let m = [Math.max(_, 0), Math.min(d, this.dims[p])];
          r.push(m), s.push(m[1] - m[0]);
        } else throw new Error(`Invalid slice: ${u}`);
      }
      let n = r.map(([p, u]) => u - p), o = n.reduce((p, u) => p * u), i = this.data, a = new i.constructor(o), l = this.stride(), c = true;
      for (let p = 1; p < n.length; ++p) if (r[p][0] !== 0 || r[p][1] !== this.dims[p]) {
        c = false;
        break;
      }
      if (c) {
        let p = r[0][0] * l[0], u = r[0][1] * l[0];
        if (ArrayBuffer.isView(i)) a.set(i.subarray(p, u));
        else if (Array.isArray(i)) {
          let _ = i.slice(p, u);
          for (let d = 0; d < _.length; ++d) a[d] = _[d];
        } else throw new Error("Unsupported data type for slicing");
      } else for (let p = 0; p < o; ++p) {
        let u = 0;
        for (let _ = n.length - 1, d = p; _ >= 0; --_) {
          let m = n[_];
          u += (d % m + r[_][0]) * l[_], d = Math.floor(d / m);
        }
        a[p] = i[u];
      }
      return new t2(this.type, a, s);
    }
    permute(...e) {
      return aA(this, e);
    }
    transpose(...e) {
      return this.permute(...e);
    }
    sum(e = null, s = false) {
      return this.norm(1, e, s);
    }
    norm(e = "fro", s = null, r = false) {
      if (e === "fro") e = 2;
      else if (typeof e == "string") throw Error(`Unsupported norm: ${e}`);
      let n = this.data, o = n instanceof BigInt64Array || n instanceof BigUint64Array;
      if (o && e !== 1) throw Error(`Expected a floating point tensor as input. Got ${this.type}`);
      let i, a;
      if (o ? (i = (u, _) => u + _, a = 0n) : (i = (u, _) => u + _ ** e, a = 0), s === null) {
        let u = n.reduce(i, a);
        return e !== 1 && (u = u ** (1 / e)), new t2(this.type, [u], []);
      }
      let [l, c, p] = Rr(i, this, s, r);
      if (e !== 1) for (let u = 0; u < c.length; ++u) c[u] = c[u] ** (1 / e);
      return new t2(l, c, p);
    }
    normalize_(e = 2, s = 1) {
      s = ht(s, this.dims.length);
      let r = this.norm(e, s, true), n = this.data, o = r.data;
      for (let i = 0; i < n.length; ++i) {
        let a = 0;
        for (let l = this.dims.length - 1, c = i, p = 1; l >= 0; --l) {
          let u = this.dims[l];
          if (l !== s) {
            let _ = c % u;
            a += _ * p, p *= this.dims[l];
          }
          c = Math.floor(c / u);
        }
        n[i] /= o[a];
      }
      return this;
    }
    normalize(e = 2, s = 1) {
      return this.clone().normalize_(e, s);
    }
    stride() {
      return sp(this.dims);
    }
    squeeze(e = null) {
      return new t2(this.type, this.data, K0(this.dims, e));
    }
    squeeze_(e = null) {
      return this.dims = K0(this.dims, e), this;
    }
    unsqueeze(e) {
      return new t2(this.type, this.data, X0(this.dims, e));
    }
    unsqueeze_(e) {
      return this.dims = X0(this.dims, e), this;
    }
    flatten_(e = 0, s = -1) {
      s = (s + this.dims.length) % this.dims.length;
      let r = this.dims.slice(0, e), n = this.dims.slice(e, s + 1), o = this.dims.slice(s + 1);
      return this.dims = [...r, n.reduce((i, a) => i * a, 1), ...o], this;
    }
    flatten(e = 0, s = -1) {
      return this.clone().flatten_(e, s);
    }
    view(...e) {
      let s = -1;
      for (let n = 0; n < e.length; ++n) if (e[n] === -1) {
        if (s !== -1) throw new Error("Only one dimension can be inferred");
        s = n;
      }
      let r = this.data;
      if (s !== -1) {
        let n = e.reduce((o, i, a) => a !== s ? o * i : o, 1);
        e[s] = r.length / n;
      }
      return new t2(this.type, r, e);
    }
    neg_() {
      let e = this.data;
      for (let s = 0; s < e.length; ++s) e[s] = -e[s];
      return this;
    }
    neg() {
      return this.clone().neg_();
    }
    gt(e) {
      let s = new Uint8Array(this.data.length), r = this.data;
      for (let n = 0; n < r.length; ++n) s[n] = r[n] > e ? 1 : 0;
      return new t2("bool", s, this.dims);
    }
    lt(e) {
      let s = new Uint8Array(this.data.length), r = this.data;
      for (let n = 0; n < r.length; ++n) s[n] = r[n] < e ? 1 : 0;
      return new t2("bool", s, this.dims);
    }
    clamp_(e, s) {
      let r = this.data;
      for (let n = 0; n < r.length; ++n) r[n] = Math.min(Math.max(r[n], e), s);
      return this;
    }
    clamp(e, s) {
      return this.clone().clamp_(e, s);
    }
    round_() {
      let e = this.data;
      for (let s = 0; s < e.length; ++s) e[s] = Math.round(e[s]);
      return this;
    }
    round() {
      return this.clone().round_();
    }
    mean(e = null, s = false) {
      return ya(this, e, s);
    }
    min(e = null, s = false) {
      if (e === null) {
        let i = $r(this.data)[0];
        return new t2(this.type, [i], []);
      }
      let [r, n, o] = Rr((i, a) => Math.min(i, a), this, e, s, 1 / 0);
      return new t2(r, n, o);
    }
    max(e = null, s = false) {
      if (e === null) {
        let i = de(this.data)[0];
        return new t2(this.type, [i], []);
      }
      let [r, n, o] = Rr((i, a) => Math.max(i, a), this, e, s, -1 / 0);
      return new t2(r, n, o);
    }
    argmin(e = null, s = false) {
      if (e !== null) throw new Error("`dim !== null` not yet implemented.");
      let r = $r(this.data)[1];
      return new t2("int64", [BigInt(r)], []);
    }
    argmax(e = null, s = false) {
      if (e !== null) throw new Error("`dim !== null` not yet implemented.");
      let r = de(this.data)[1];
      return new t2("int64", [BigInt(r)], []);
    }
    repeat(...e) {
      if (e.length < this.dims.length) throw new Error(`Number of dimensions of repeat dims (${e.length}) cannot be smaller than number of dimensions of tensor (${this.dims.length})`);
      if (e.every((p) => p === 1)) {
        if (e.length === this.dims.length) return this.clone();
        let p = e.length - this.dims.length, u = Array(p).fill(1).concat(this.dims);
        return new t2(this.type, this.data.slice(), u);
      }
      let s = e.length - this.dims.length, r = Array(s).fill(1).concat(this.dims), n = r.map((p, u) => p * e[u]), o = n.reduce((p, u) => p * u, 1), i = this.data, a = new i.constructor(o), l = sp(r), c = sp(n);
      for (let p = 0; p < o; ++p) {
        let u = p, _ = 0;
        for (let d = 0; d < n.length; ++d) {
          let m = Math.floor(u / c[d]);
          u = u % c[d];
          let f = m % r[d];
          _ += f * l[d];
        }
        a[p] = i[_];
      }
      return new t2(this.type, a, n);
    }
    tile(...e) {
      if (e.length < this.dims.length) {
        let s = this.dims.length - e.length;
        e = Array(s).fill(1).concat(e);
      }
      return this.repeat(...e);
    }
    to(e) {
      if (this.type === e) return this;
      if (!bt.hasOwnProperty(e)) throw new Error(`Unsupported type: ${e}`);
      let s, r = ["int64", "uint64"].includes(this.type), n = ["int64", "uint64"].includes(e);
      if (r && !n) s = Number;
      else if (!r && n) ["float16", "float32", "float64"].includes(this.type) ? s = (o) => BigInt(Math.floor(o)) : s = BigInt;
      else if (this.type === "float16" && e == "float32" && this.data instanceof Uint16Array) return new t2(e, N0(this.data), this.dims);
      return new t2(e, bt[e].from(this.data, s), this.dims);
    }
  };
  function iA(t6, e) {
    let s = t6.length, r = e.reduce((o, i) => o * i);
    if (s !== r) throw Error(`cannot reshape array of size ${s} into shape (${e})`);
    let n = t6;
    for (let o = e.length - 1; o >= 0; o--) n = n.reduce((i, a) => {
      let l = i[i.length - 1];
      return l.length < e[o] ? l.push(a) : i.push([a]), i;
    }, [[]]);
    return n[0];
  }
  function aA(t6, e) {
    let [s, r] = O0(t6.data, t6.dims, e);
    return new E(t6.type, s, r);
  }
  function rp(t6, [e, s], r = "bilinear", n = false) {
    let o = t6.dims.at(-3) ?? 1, i = t6.dims.at(-2), a = t6.dims.at(-1), l = S0(t6.data, [o, i, a], [e, s], r, n);
    return new E(t6.type, l, [o, e, s]);
  }
  async function je(t6, { size: e = null, mode: s = "bilinear" } = {}) {
    if (t6.dims.length !== 4) throw new Error("`interpolate_4d` currently only supports 4D input.");
    if (!e) throw new Error("`interpolate_4d` requires a `size` argument.");
    let r;
    if (e.length === 2) r = [...t6.dims.slice(0, 2), ...e];
    else if (e.length === 3) r = [t6.dims[0], ...e];
    else if (e.length === 4) r = e;
    else throw new Error("`size` must be of length 2, 3, or 4.");
    let n;
    if (s === "nearest") n = await ft.nearest_interpolate_4d;
    else if (s === "bilinear") n = await ft.bilinear_interpolate_4d;
    else if (s === "bicubic") n = await ft.bicubic_interpolate_4d;
    else throw new Error(`Unsupported mode: ${s}`);
    let o = new E("int64", new BigInt64Array(r.map(BigInt)), [r.length]);
    return await n({ x: t6, s: o });
  }
  async function Q0(t6, e) {
    return await (await ft.matmul)({ a: t6, b: e });
  }
  async function lt(t6, e) {
    let s = await ft.top_k;
    return e == null ? e = t6.dims.at(-1) : e = Math.min(e, t6.dims.at(-1)), await s({ x: t6, k: new E("int64", [BigInt(e)], [1]) });
  }
  var xa = (t6) => new E("int64", t6, [t6.length]);
  async function wa(t6, e, s, r, n) {
    return await (await ft.slice)({ x: t6, s: xa(e), e: xa(s), a: xa(r), t: xa(n ?? new Array(r.length).fill(1)) });
  }
  function Y0(t6, e) {
    let s = t6.data, r = e.data, n = [t6.dims[0], t6.dims[2]], o = new s.constructor(n[0] * n[1]), [i, a, l] = t6.dims, c = 0;
    for (let p = 0; p < i; ++p) {
      let u = p * l * a;
      for (let _ = 0; _ < l; ++_) {
        let d = 0, m = 0, f = p * a, g = u + _;
        for (let w = 0; w < a; ++w) {
          let y = Number(r[f + w]);
          m += y, d += s[g + w * l] * y;
        }
        let x = d / m;
        o[c++] = x;
      }
    }
    return new E(t6.type, o, n);
  }
  function K0(t6, e) {
    return t6 = t6.slice(), e === null ? t6 = t6.filter((s) => s !== 1) : typeof e == "number" ? t6[e] === 1 && t6.splice(e, 1) : Array.isArray(e) && (t6 = t6.filter((s, r) => s !== 1 || !e.includes(r))), t6;
  }
  function X0(t6, e) {
    return e = ht(e, t6.length + 1), t6 = t6.slice(), t6.splice(e, 0, 1), t6;
  }
  function ht(t6, e, s = null, r = true) {
    if (t6 < -e || t6 >= e) {
      if (r) throw new Error(`IndexError: index ${t6} is out of bounds for dimension${s === null ? "" : " " + s} with size ${e}`);
      return t6 < -e ? 0 : e;
    }
    return t6 < 0 && (t6 = (t6 % e + e) % e), t6;
  }
  function ie(t6, e = 0) {
    e = ht(e, t6[0].dims.length);
    let s = t6[0].dims.slice();
    s[e] = t6.reduce((i, a) => i + a.dims[e], 0);
    let r = s.reduce((i, a) => i * a, 1), n = new t6[0].data.constructor(r), o = t6[0].type;
    if (e === 0) {
      let i = 0;
      for (let a of t6) {
        let l = a.data;
        n.set(l, i), i += l.length;
      }
    } else {
      let i = 0;
      for (let a = 0; a < t6.length; ++a) {
        let { data: l, dims: c } = t6[a];
        for (let p = 0; p < l.length; ++p) {
          let u = 0;
          for (let _ = c.length - 1, d = p, m = 1; _ >= 0; --_) {
            let f = c[_], g = d % f;
            _ === e && (g += i), u += g * m, m *= s[_], d = Math.floor(d / f);
          }
          n[u] = l[p];
        }
        i += c[e];
      }
    }
    return new E(o, n, s);
  }
  function qe(t6, e = 0) {
    return ie(t6.map((s) => s.unsqueeze(e)), e);
  }
  function Rr(t6, e, s, r = false, n = null) {
    let o = e.data, i = e.dims;
    s = ht(s, i.length);
    let a = i.slice();
    a[s] = 1;
    let l = new o.constructor(o.length / i[s]);
    n !== null && l.fill(n);
    for (let c = 0; c < o.length; ++c) {
      let p = 0;
      for (let u = i.length - 1, _ = c, d = 1; u >= 0; --u) {
        let m = i[u];
        if (u !== s) {
          let f = _ % m;
          p += f * d, d *= a[u];
        }
        _ = Math.floor(_ / m);
      }
      l[p] = t6(l[p], o[c], c, p);
    }
    return r || a.splice(s, 1), [e.type, l, a];
  }
  function np(t6, e = null, s = 1, r = false) {
    let n = t6.data, o = t6.dims;
    if (e === null) {
      let d = n.reduce((x, w) => x + w, 0) / n.length, m = Math.sqrt(n.reduce((x, w) => x + (w - d) ** 2, 0) / (n.length - s)), f = new E(t6.type, [d], []);
      return [new E(t6.type, [m], []), f];
    }
    e = ht(e, o.length);
    let i = ya(t6, e, r), a = i.data, [l, c, p] = Rr((_, d, m, f) => _ + (d - a[f]) ** 2, t6, e, r);
    for (let _ = 0; _ < c.length; ++_) c[_] = Math.sqrt(c[_] / (o[e] - s));
    return [new E(l, c, p), i];
  }
  function ya(t6, e = null, s = false) {
    let r = t6.dims, n = t6.data;
    if (e === null) {
      let l = n.reduce((c, p) => c + p, 0);
      return new E(t6.type, [l / n.length], []);
    }
    e = ht(e, r.length);
    let [o, i, a] = Rr((l, c) => l + c, t6, e, s);
    if (r[e] !== 1) for (let l = 0; l < i.length; ++l) i[l] /= r[e];
    return new E(o, i, a);
  }
  function sp(t6) {
    let e = new Array(t6.length);
    for (let s = t6.length - 1, r = 1; s >= 0; --s) e[s] = r, r *= t6[s];
    return e;
  }
  function op(t6, e, s, r) {
    let n = t6.reduce((o, i) => o * i, 1);
    return new E(s, new r(n).fill(e), t6);
  }
  function ke(t6, e) {
    let s, r;
    if (typeof e == "number") s = "float32", r = Float32Array;
    else if (typeof e == "bigint") s = "int64", r = BigInt64Array;
    else if (typeof e == "boolean") s = "bool", r = Uint8Array;
    else throw new Error(`Unsupported data type: ${typeof e}`);
    return op(t6, e, s, r);
  }
  function Dr(t6, e) {
    return ke(t6.dims, e);
  }
  function Me(t6) {
    return op(t6, 1n, "int64", BigInt64Array);
  }
  function ba(t6) {
    return Me(t6.dims);
  }
  function ip(t6) {
    return op(t6, 0n, "int64", BigInt64Array);
  }
  function ap(t6) {
    return ip(t6.dims);
  }
  function J0(t6) {
    let e = t6.reduce((s, r) => s * r, 1);
    return new E("float32", Float32Array.from({ length: e }, () => ns.gauss()), t6);
  }
  function Z0(t6, e) {
    if (t6.dims.length !== 2) throw new Error("The tensor must have 2 dimensions");
    if (t6.dims.at(-1) % 8 !== 0) throw new Error("The last dimension of the tensor must be a multiple of 8");
    if (!["binary", "ubinary"].includes(e)) throw new Error("The precision must be either 'binary' or 'ubinary'");
    let s = e === "binary", r = s ? "int8" : "uint8", n = s ? Int8Array : Uint8Array, o = t6.data, i = new n(o.length / 8);
    for (let a = 0; a < o.length; ++a) {
      let l = o[a] > 0 ? 1 : 0, c = Math.floor(a / 8), p = a % 8;
      i[c] |= l << 7 - p, s && p === 0 && (i[c] -= 128);
    }
    return new E(r, i, [t6.dims[0], t6.dims[1] / 8]);
  }
  async function $s(t6) {
    if (!t6) throw new Error("modelId is required for get_tokenizer_files");
    return (await We(t6, "tokenizer_config.json", {})).exists ? ["tokenizer.json", "tokenizer_config.json"] : [];
  }
  async function lp(t6, e) {
    let s = await $s(t6);
    return await Promise.all(s.map((r) => Oe(t6, r, true, e)));
  }
  function cp(t6) {
    let e = t6.dims;
    switch (e.length) {
      case 1:
        return t6.tolist();
      case 2:
        if (e[0] !== 1) throw new Error("Unable to decode tensor with `batch size !== 1`. Use `tokenizer.batch_decode(...)` for batched inputs.");
        return t6.tolist()[0];
      default:
        throw new Error(`Expected tensor to have 1-2 dimensions, got ${e.length}.`);
    }
  }
  var lA = ["bos_token", "eos_token", "unk_token", "sep_token", "pad_token", "cls_token", "mask_token"];
  function cA(t6, e, s, r) {
    for (let n of Object.keys(t6)) {
      let o = e - t6[n].length, i = s(n), a = new Array(o).fill(i);
      t6[n] = r === "right" ? Fe(t6[n], a) : Fe(a, t6[n]);
    }
  }
  function pA(t6, e) {
    for (let s of Object.keys(t6)) t6[s].length = e;
  }
  function is(t6, ...e) {
    for (let s of e) {
      if (!Object.hasOwn(t6, s)) continue;
      let r = t6[s];
      if (r) if (typeof r == "object") {
        if (r.__type === "AddedToken") return r.content;
        throw Error(`Unknown token: ${r}`);
      } else return r;
    }
    return null;
  }
  function uA(t6) {
    let e = [];
    for (let s of t6.get_added_tokens_decoder().values()) s.special && e.push(s);
    return e;
  }
  var P = class extends xe {
    constructor(e, s) {
      super();
      __publicField(this, "return_token_type_ids", false);
      __publicField(this, "padding_side", "right");
      if (this._tokenizerJSON = e, this._tokenizerConfig = s, this._tokenizer = new r0(e, s), this.config = s, this.padding_side = s.padding_side ?? this.padding_side, this.mask_token = is(s, "mask_token"), this.mask_token_id = this._tokenizer.token_to_id(this.mask_token), this.pad_token = is(s, "pad_token", "eos_token"), this.pad_token_id = this._tokenizer.token_to_id(this.pad_token), this.sep_token = is(s, "sep_token"), this.sep_token_id = this._tokenizer.token_to_id(this.sep_token), this.unk_token = is(s, "unk_token"), this.unk_token_id = this._tokenizer.token_to_id(this.unk_token), this.bos_token = is(s, "bos_token"), this.bos_token_id = this._tokenizer.token_to_id(this.bos_token), this.eos_token = is(s, "eos_token"), this.eos_token_id = this._tokenizer.token_to_id(this.eos_token), this.chat_template = s.chat_template ?? null, Array.isArray(this.chat_template)) {
        let n = /* @__PURE__ */ Object.create(null);
        for (let { name: o, template: i } of this.chat_template) {
          if (typeof o != "string" || typeof i != "string") throw new Error('Chat template must be a list of objects with "name" and "template" properties');
          n[o] = i;
        }
        this.chat_template = n;
      }
      this._compiled_template_cache = /* @__PURE__ */ new Map();
      let r = uA(this._tokenizer);
      this.all_special_ids = r.map((n) => n.id), this.all_special_tokens = r.map((n) => n.content);
    }
    static async from_pretrained(e, { progress_callback: s = null, config: r = null, cache_dir: n = null, local_files_only: o = false, revision: i = "main" } = {}) {
      let a = await lp(e, { progress_callback: s, config: r, cache_dir: n, local_files_only: o, revision: i });
      return new this(...a);
    }
    get_vocab() {
      return this._tokenizer.get_vocab();
    }
    get model_max_length() {
      return this._tokenizerConfig.model_max_length ?? 1 / 0;
    }
    get add_eos_token() {
      return this._tokenizerConfig.add_eos_token;
    }
    get add_bos_token() {
      return this._tokenizerConfig.add_bos_token;
    }
    convert_tokens_to_ids(e) {
      return typeof e == "string" ? this._tokenizer.token_to_id(e) : e.map((s) => this._tokenizer.token_to_id(s));
    }
    _call(e, { text_pair: s = null, add_special_tokens: r = true, padding: n = false, truncation: o = null, max_length: i = null, return_tensor: a = true, return_token_type_ids: l = null } = {}) {
      let c = Array.isArray(e), p;
      if (c) {
        if (e.length === 0) throw Error("text array must be non-empty");
        if (s !== null) {
          if (Array.isArray(s)) {
            if (e.length !== s.length) throw Error("text and text_pair must have the same length");
          } else throw Error("text_pair must also be an array");
          p = e.map((_, d) => this._encode_plus(_, { text_pair: s[d], add_special_tokens: r, return_token_type_ids: l }));
        } else p = e.map((_) => this._encode_plus(_, { add_special_tokens: r, return_token_type_ids: l }));
      } else {
        if (e == null) throw Error("text may not be null or undefined");
        if (Array.isArray(s)) throw Error("When specifying `text_pair`, since `text` is a string, `text_pair` must also be a string (i.e., not an array).");
        p = [this._encode_plus(e, { text_pair: s, add_special_tokens: r, return_token_type_ids: l })];
      }
      if (i === null ? i = this.model_max_length : o === null && (n === true ? (F.warn("`max_length` is ignored when `padding: true` and there is no truncation strategy. To pad to max length, use `padding: 'max_length'`."), i = this.model_max_length) : n === false && (F.warn("Truncation was not explicitly activated but `max_length` is provided a specific value, please use `truncation: true` to explicitly truncate examples to max length."), o = true)), n === true && (i = Math.min(de(p.map((_) => _.input_ids.length))[0], i ?? 1 / 0)), i = Math.min(i, this.model_max_length ?? 1 / 0), n || o) for (let _ = 0; _ < p.length; ++_) p[_].input_ids.length !== i && (p[_].input_ids.length > i ? o && pA(p[_], i) : n && cA(p[_], i, (d) => d === "input_ids" ? this.pad_token_id : 0, this.padding_side));
      let u = {};
      if (a) {
        if (!(n && o) && p.some((d) => {
          for (let m of Object.keys(d)) if (d[m].length !== p[0][m]?.length) return true;
          return false;
        })) throw Error("Unable to create tensor, you should probably activate truncation and/or padding with 'padding=true' and 'truncation=true' to have batched tensors with the same length.");
        let _ = [p.length, p[0].input_ids.length];
        for (let d of Object.keys(p[0])) u[d] = new E("int64", BigInt64Array.from(p.flatMap((m) => m[d]).map(BigInt)), _);
      } else {
        for (let _ of Object.keys(p[0])) u[_] = p.map((d) => d[_]);
        if (!c) for (let _ of Object.keys(u)) u[_] = u[_][0];
      }
      return u;
    }
    _encode_text(e) {
      return e === null ? null : this._tokenizer.encode(e).tokens;
    }
    _encode_plus(e, { text_pair: s = null, add_special_tokens: r = true, return_token_type_ids: n = null } = {}) {
      let { ids: o, attention_mask: i, token_type_ids: a } = this._tokenizer.encode(e, { text_pair: s, add_special_tokens: r, return_token_type_ids: n ?? this.return_token_type_ids });
      return { input_ids: o, attention_mask: i, ...a ? { token_type_ids: a } : {} };
    }
    tokenize(e, { pair: s = null, add_special_tokens: r = false } = {}) {
      return this._tokenizer.tokenize(e, { text_pair: s, add_special_tokens: r });
    }
    encode(e, { text_pair: s = null, add_special_tokens: r = true, return_token_type_ids: n = null } = {}) {
      return this._tokenizer.encode(e, { text_pair: s, add_special_tokens: r, return_token_type_ids: n }).ids;
    }
    batch_decode(e, s = {}) {
      return e instanceof E && (e = e.tolist()), e.map((r) => this.decode(r, s));
    }
    decode(e, s = {}) {
      if (e instanceof E && (e = cp(e)), !Array.isArray(e) || e.length === 0 || !Dy(e[0])) throw Error("token_ids must be a non-empty array of integers.");
      return this.decode_single(e, s);
    }
    decode_single(e, { skip_special_tokens: s = false, clean_up_tokenization_spaces: r = null }) {
      return this._tokenizer.decode(e, { skip_special_tokens: s, clean_up_tokenization_spaces: r });
    }
    get_chat_template({ chat_template: e = null, tools: s = null } = {}) {
      if (this.chat_template && typeof this.chat_template == "object") {
        let r = this.chat_template;
        if (e !== null && Object.hasOwn(r, e)) e = r[e];
        else if (e === null) if (s !== null && "tool_use" in r) e = r.tool_use;
        else if ("default" in r) e = r.default;
        else throw Error(`This model has multiple chat templates with no default specified! Please either pass a chat template or the name of the template you wish to use to the 'chat_template' argument. Available template names are ${Object.keys(r).sort()}.`);
      } else if (e === null) if (this.chat_template) e = this.chat_template;
      else throw Error("Cannot use apply_chat_template() because tokenizer.chat_template is not set and no template argument was passed! For information about writing templates and setting the tokenizer.chat_template attribute, please see the documentation at https://huggingface.co/docs/transformers/main/en/chat_templating");
      return e;
    }
    apply_chat_template(e, { tools: s = null, documents: r = null, chat_template: n = null, add_generation_prompt: o = false, tokenize: i = true, padding: a = false, truncation: l = false, max_length: c = null, return_tensor: p = true, return_dict: u = true, tokenizer_kwargs: _ = {}, ...d } = {}) {
      if (n = this.get_chat_template({ chat_template: n, tools: s }), typeof n != "string") throw Error(`chat_template must be a string, but got ${typeof n}`);
      let m = this._compiled_template_cache.get(n);
      m === void 0 && (m = new f0(n), this._compiled_template_cache.set(n, m));
      let f = /* @__PURE__ */ Object.create(null);
      for (let x of lA) {
        let w = is(this.config, x);
        w && (f[x] = w);
      }
      let g = m.render({ messages: e, add_generation_prompt: o, tools: s, documents: r, ...f, ...d });
      if (i) {
        let x = this._call(g, { add_special_tokens: false, padding: a, truncation: l, max_length: c, return_tensor: p, ..._ });
        return u ? x : x.input_ids;
      }
      return g;
    }
  };
  function Fs(t6, e, s, r) {
    if (!("language_codes" in t6) || !Array.isArray(t6.language_codes)) throw new Error("Tokenizer must have `language_codes` attribute set and it should be an array of language ids.");
    if (!("languageRegex" in t6) || !(t6.languageRegex instanceof RegExp)) throw new Error("Tokenizer must have `languageRegex` attribute set and it should be a regular expression.");
    if (!("lang_to_token" in t6) || typeof t6.lang_to_token != "function") throw new Error("Tokenizer must have `lang_to_token` attribute set and it should be a function.");
    let n = r.src_lang, o = r.tgt_lang;
    if (!t6.language_codes.includes(o)) throw new Error(`Target language code "${o}" is not valid. Must be one of: {${t6.language_codes.join(", ")}}`);
    if (n !== void 0) {
      if (!t6.language_codes.includes(n)) throw new Error(`Source language code "${n}" is not valid. Must be one of: {${t6.language_codes.join(", ")}}`);
      for (let i of t6._tokenizer.post_processor.config.single) if ("SpecialToken" in i && t6.languageRegex.test(i.SpecialToken.id)) {
        i.SpecialToken.id = t6.lang_to_token(n);
        break;
      }
    }
    return r.forced_bos_token_id = t6._tokenizer.token_to_id(t6.lang_to_token(o)), t6._call(e, s);
  }
  var tu = {};
  Os(tu, { AlbertTokenizer: () => pp, AutoTokenizer: () => W, BartTokenizer: () => up, BertTokenizer: () => _p, BlenderbotSmallTokenizer: () => dp, BlenderbotTokenizer: () => mp, BloomTokenizer: () => fp, CLIPTokenizer: () => gp, CamembertTokenizer: () => hp, CodeGenTokenizer: () => wp, CodeLlamaTokenizer: () => xp, CohereAsrTokenizer: () => bp, CohereTokenizer: () => yp, ConvBertTokenizer: () => kp, DebertaTokenizer: () => Ep, DebertaV2Tokenizer: () => vp, DistilBertTokenizer: () => Ap, ElectraTokenizer: () => Mp, EsmTokenizer: () => Sp, FalconTokenizer: () => Op, GPT2Tokenizer: () => Tp, GPTNeoXTokenizer: () => zp, GemmaTokenizer: () => Ip, HerbertTokenizer: () => Cp, LlamaTokenizer: () => Pp, M2M100Tokenizer: () => Np, MBart50Tokenizer: () => $p, MBartTokenizer: () => qr, MPNetTokenizer: () => Dp, MarianTokenizer: () => Lp, MgpstrTokenizer: () => Fp, MobileBertTokenizer: () => Rp, NllbTokenizer: () => qp, NougatTokenizer: () => jp, PreTrainedTokenizer: () => P, Qwen2Tokenizer: () => Bp, RoFormerTokenizer: () => Gp, RobertaTokenizer: () => Up, SiglipTokenizer: () => Wp, SpeechT5Tokenizer: () => Vp, SqueezeBertTokenizer: () => Hp, T5Tokenizer: () => Kp, TokenizersBackend: () => P, VitsTokenizer: () => Qp, Wav2Vec2CTCTokenizer: () => Yp, WhisperTokenizer: () => Jp, XLMRobertaTokenizer: () => Zp, XLMTokenizer: () => eu });
  var pp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var up = class extends P {
  };
  var _p = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var dp = class extends P {
  };
  var mp = class extends P {
  };
  var fp = class extends P {
  };
  var hp = class extends P {
  };
  var gp = class extends P {
  };
  var xp = class extends P {
  };
  var wp = class extends P {
  };
  var yp = class extends P {
  };
  var bp = class extends P {
  };
  var kp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var vp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Ep = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Ap = class extends P {
  };
  var Mp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Sp = class extends P {
  };
  var Op = class extends P {
  };
  var Ip = class extends P {
  };
  var zp = class extends P {
  };
  var Tp = class extends P {
  };
  var Cp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Pp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "padding_side", "left");
    }
  };
  var Np = class extends P {
    constructor(e, s) {
      super(e, s), this.languageRegex = /^__[a-z]{2,3}__$/, this.language_codes = this.all_special_tokens.filter((r) => this.languageRegex.test(r)).map((r) => r.slice(2, -2)), this.lang_to_token = (r) => `__${r}__`;
    }
    _build_translation_inputs(e, s, r) {
      return Fs(this, e, s, r);
    }
  };
  var Lp = class extends P {
    constructor(e, s) {
      super(e, s), this.languageRegex = /^(>>\w+<<)\s*/g, this.supported_language_codes = Array.from(this.get_vocab().keys()).filter((r) => this.languageRegex.test(r)), F.warn('WARNING: `MarianTokenizer` is not yet supported by Hugging Face\'s "fast" tokenizers library. Therefore, you may experience slightly inaccurate results.');
    }
    _encode_text(e) {
      if (e === null) return null;
      let [s, ...r] = e.trim().split(this.languageRegex);
      if (r.length === 0) return super._encode_text(s);
      if (r.length === 2) {
        let [n, o] = r;
        return this.supported_language_codes.includes(n) || F.warn(`Unsupported language code "${n}" detected, which may lead to unexpected behavior. Should be one of: ${JSON.stringify(this.supported_language_codes)}`), Fe([n], super._encode_text(o));
      }
    }
  };
  var qr = class extends P {
    constructor(e, s) {
      super(e, s), this.languageRegex = /^[a-z]{2}_[A-Z]{2}$/, this.language_codes = this.all_special_tokens.filter((r) => this.languageRegex.test(r)).map((r) => r), this.lang_to_token = (r) => r;
    }
    _build_translation_inputs(e, s, r) {
      return Fs(this, e, s, r);
    }
  };
  var $p = class extends qr {
  };
  var Fp = class extends P {
  };
  var Rp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Dp = class extends P {
  };
  var qp = class extends P {
    constructor(e, s) {
      super(e, s), this.languageRegex = /^[a-z]{3}_[A-Z][a-z]{3}$/, this.language_codes = this.all_special_tokens.filter((r) => this.languageRegex.test(r)), this.lang_to_token = (r) => r;
    }
    _build_translation_inputs(e, s, r) {
      return Fs(this, e, s, r);
    }
  };
  var jp = class extends P {
  };
  var Bp = class extends P {
  };
  var Up = class extends P {
  };
  var Gp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Wp = class extends P {
  };
  var Vp = class extends P {
  };
  var Hp = class extends P {
    constructor() {
      super(...arguments);
      __publicField(this, "return_token_type_ids", true);
    }
  };
  var Kp = class extends P {
  };
  var Xp = class extends Je {
    decode_chain(e) {
      let s = "";
      for (let r = 1; r < e.length; r += 2) s += e[r];
      return [s];
    }
  };
  var Qp = class extends P {
    constructor(e, s) {
      super(e, s), this._tokenizer.decoder = new Xp({ type: "VitsDecoder" });
    }
  };
  var Yp = class extends P {
  };
  var eb = [["en", "english"], ["zh", "chinese"], ["de", "german"], ["es", "spanish"], ["ru", "russian"], ["ko", "korean"], ["fr", "french"], ["ja", "japanese"], ["pt", "portuguese"], ["tr", "turkish"], ["pl", "polish"], ["ca", "catalan"], ["nl", "dutch"], ["ar", "arabic"], ["sv", "swedish"], ["it", "italian"], ["id", "indonesian"], ["hi", "hindi"], ["fi", "finnish"], ["vi", "vietnamese"], ["he", "hebrew"], ["uk", "ukrainian"], ["el", "greek"], ["ms", "malay"], ["cs", "czech"], ["ro", "romanian"], ["da", "danish"], ["hu", "hungarian"], ["ta", "tamil"], ["no", "norwegian"], ["th", "thai"], ["ur", "urdu"], ["hr", "croatian"], ["bg", "bulgarian"], ["lt", "lithuanian"], ["la", "latin"], ["mi", "maori"], ["ml", "malayalam"], ["cy", "welsh"], ["sk", "slovak"], ["te", "telugu"], ["fa", "persian"], ["lv", "latvian"], ["bn", "bengali"], ["sr", "serbian"], ["az", "azerbaijani"], ["sl", "slovenian"], ["kn", "kannada"], ["et", "estonian"], ["mk", "macedonian"], ["br", "breton"], ["eu", "basque"], ["is", "icelandic"], ["hy", "armenian"], ["ne", "nepali"], ["mn", "mongolian"], ["bs", "bosnian"], ["kk", "kazakh"], ["sq", "albanian"], ["sw", "swahili"], ["gl", "galician"], ["mr", "marathi"], ["pa", "punjabi"], ["si", "sinhala"], ["km", "khmer"], ["sn", "shona"], ["yo", "yoruba"], ["so", "somali"], ["af", "afrikaans"], ["oc", "occitan"], ["ka", "georgian"], ["be", "belarusian"], ["tg", "tajik"], ["sd", "sindhi"], ["gu", "gujarati"], ["am", "amharic"], ["yi", "yiddish"], ["lo", "lao"], ["uz", "uzbek"], ["fo", "faroese"], ["ht", "haitian creole"], ["ps", "pashto"], ["tk", "turkmen"], ["nn", "nynorsk"], ["mt", "maltese"], ["sa", "sanskrit"], ["lb", "luxembourgish"], ["my", "myanmar"], ["bo", "tibetan"], ["tl", "tagalog"], ["mg", "malagasy"], ["as", "assamese"], ["tt", "tatar"], ["haw", "hawaiian"], ["ln", "lingala"], ["ha", "hausa"], ["ba", "bashkir"], ["jw", "javanese"], ["su", "sundanese"]];
  var jr = new Map(eb);
  var _A = new Map([...eb.map(([t6, e]) => [e, t6]), ["burmese", "my"], ["valencian", "ca"], ["flemish", "nl"], ["haitian", "ht"], ["letzeburgesch", "lb"], ["pushto", "ps"], ["panjabi", "pa"], ["moldavian", "ro"], ["moldovan", "ro"], ["sinhalese", "si"], ["castilian", "es"]]);
  function tb(t6) {
    t6 = t6.toLowerCase();
    let e = _A.get(t6);
    if (e === void 0) {
      let s = t6.match(/^<\|([a-z]{2})\|>$/);
      if (s && (t6 = s[1]), jr.has(t6)) e = t6;
      else {
        let n = t6.length === 2 ? jr.keys() : jr.values();
        throw new Error(`Language "${t6}" is not supported. Must be one of: ${JSON.stringify(Array.from(n))}`);
      }
    }
    return e;
  }
  var dA = "\\p{P}\\u0021-\\u002F\\u003A-\\u0040\\u005B-\\u0060\\u007B-\\u007E";
  var sb = new RegExp(`^[${dA}]+$`, "gu");
  var mA = 0.1;
  var Jp = class extends P {
    get timestamp_begin() {
      return this._tokenizer.token_to_id("<|notimestamps|>") + 1;
    }
    _decode_asr(e, { return_timestamps: s = false, return_language: r = false, time_precision: n = null, force_full_sequences: o = true } = {}) {
      if (n === null) throw Error("Must specify time_precision");
      let i = null, a = s === "word";
      function l() {
        return { language: i, timestamp: [null, null], text: "" };
      }
      let c = [], p = l(), u = 0, _ = this.timestamp_begin, m = _ + 1500, f = [], g = [], x = false, w = null, y = new Set(this.all_special_ids);
      for (let k of e) {
        let S = k.tokens, I = a ? k.token_timestamps : null, $ = null, C = _;
        if ("stride" in k) {
          let [B, H, V] = k.stride;
          if (u -= H, w = B - V, H && (C = H / n + _), V) for (let Z = S.length - 1; Z >= 0; --Z) {
            let R = Number(S[Z]);
            if (R >= _) {
              if ($ !== null && (R - _) * n < w) break;
              $ = R;
            }
          }
        }
        let q = [], D = [];
        for (let B = 0; B < S.length; ++B) {
          let H = Number(S[B]);
          if (y.has(H)) {
            let V = this.decode([H]), Z = jr.get(V.slice(2, -2));
            if (Z !== void 0) {
              if (i !== null && Z !== i && !s) {
                f.push(q);
                let R = this.findLongestCommonSequence(f)[0], A = this.decode(R);
                p.text = A, c.push(p), f = [], q = [], p = l();
              }
              i = p.language = Z;
            }
          } else if (H >= _ && H <= m) {
            let V = (H - _) * n + u, Z = os(V, 2);
            if ($ !== null && H >= $) x = true;
            else if (x || f.length > 0 && H < C) x = false;
            else if (p.timestamp[0] === null) p.timestamp[0] = Z;
            else if (Z !== p.timestamp[0]) {
              p.timestamp[1] = Z, f.push(q), a && g.push(D);
              let [R, A] = this.findLongestCommonSequence(f, g), O = this.decode(R);
              if (p.text = O, a && (p.words = this.collateWordTimestamps(R, A, i), p.words.length > 0 && p.timestamp[1] !== null)) for (let z of p.words) z.timestamp[1] > p.timestamp[1] && p.timestamp[1] >= z.timestamp[0] && (z.timestamp[1] = p.timestamp[1]);
              c.push(p), f = [], q = [], g = [], D = [], p = l();
            }
          } else if (q.push(H), a) {
            let V = os(I[B] + u, 2), Z;
            if (B + 1 < I.length) {
              Z = os(I[B + 1] + u, 2);
              let R = this.decode([H]);
              sb.test(R) && (Z = os(Math.min(V + n, Z), 2));
            } else Z = null;
            D.push([V, Z]);
          }
        }
        if ("stride" in k) {
          let [B, H, V] = k.stride;
          u += B - V;
        }
        q.length > 0 ? (f.push(q), a && g.push(D)) : f.every((B) => B.length === 0) && (p = l(), f = [], q = [], g = [], D = []);
      }
      if (f.length > 0) {
        if (o && s) throw new Error("Whisper did not predict an ending timestamp, which can happen if audio is cut off in the middle of a word. Also make sure WhisperTimeStampLogitsProcessor was used during generation.");
        let [k, S] = this.findLongestCommonSequence(f, g), I = this.decode(k);
        p.text = I, a && (p.words = this.collateWordTimestamps(k, S, i)), c.push(p);
      }
      let b = /* @__PURE__ */ Object.create(null), v = c.map((k) => k.text).join("");
      if (s || r) {
        for (let k = 0; k < c.length; ++k) {
          let S = c[k];
          s || delete S.timestamp, r || delete S.language;
        }
        if (a) {
          let k = [];
          for (let S of c) for (let I of S.words) k.push(I);
          b = { chunks: k };
        } else b = { chunks: c };
      }
      return [v, b];
    }
    findLongestCommonSequence(e, s = null) {
      let r = e[0], n = r.length, o = [], i = Array.isArray(s) && s.length > 0, a = i ? [] : null, l = i ? s[0] : null;
      for (let c = 1; c < e.length; ++c) {
        let p = e[c], u = 0, _ = [n, n, 0, 0], d = p.length;
        for (let b = 1; b < n + d; ++b) {
          let v = Math.max(0, n - b), k = Math.min(n, n + d - b), S = r.slice(v, k), I = Math.max(0, b - n), $ = Math.min(d, b), C = p.slice(I, $);
          if (S.length !== C.length) throw new Error("There is a bug within whisper `decode_asr` function, please report it. Dropping to prevent bad inference.");
          let q;
          i ? q = S.filter((H, V) => H === C[V] && l[v + V][0] - mA <= s[c][I + V][0]).length : q = S.filter((H, V) => H === C[V]).length;
          let D = b / 1e4, B = q / b + D;
          q > 1 && B > u && (u = B, _ = [v, k, I, $]);
        }
        let [m, f, g, x] = _, w = Math.floor((f + m) / 2), y = Math.floor((x + g) / 2);
        if (i && u === 0 && n > 0) {
          let b = l[n - 1][0], v = s[c].findIndex((k) => k[0] >= b);
          y = v === -1 ? p.length : v;
        }
        o.push(...r.slice(0, w)), r = p.slice(y), n = r.length, i && (a.push(...l.slice(0, w)), l = s[c].slice(y));
      }
      return o.push(...r), i ? (a.push(...l), [o, a]) : [o, []];
    }
    collateWordTimestamps(e, s, r) {
      let [n, o, i] = this.combineTokensIntoWords(e, r), a = [];
      for (let l = 0; l < n.length; ++l) {
        let c = i[l];
        a.push({ text: n[l], timestamp: [s[c.at(0)][0], s[c.at(-1)][1]] });
      }
      return a;
    }
    combineTokensIntoWords(e, s, r = `"'\u201C\xA1\xBF([{-`, n = `"'.\u3002,\uFF0C!\uFF01?\uFF1F:\uFF1A\u201D)]}\u3001`) {
      s = s ?? "english";
      let o, i, a;
      return ["chinese", "japanese", "thai", "lao", "myanmar"].includes(s) ? [o, i, a] = this.splitTokensOnUnicode(e) : [o, i, a] = this.splitTokensOnSpaces(e), this.mergePunctuations(o, i, a, r, n);
    }
    decode(e, s) {
      let r;
      return s?.decode_with_timestamps ? (e instanceof E && (e = cp(e)), r = this.decodeWithTimestamps(e, s)) : r = super.decode(e, s), r;
    }
    decodeWithTimestamps(e, s) {
      let r = s?.time_precision ?? 0.02, n = this.all_special_ids.at(-1) + 1, o = [[]];
      for (let i of e) if (i = Number(i), i >= n) {
        let a = ((i - n) * r).toFixed(2);
        o.push(`<|${a}|>`), o.push([]);
      } else o[o.length - 1].push(i);
      return o = o.map((i) => typeof i == "string" ? i : super.decode(i, s)), o.join("");
    }
    splitTokensOnUnicode(e) {
      let s = this.decode(e, { decode_with_timestamps: true }), r = "\uFFFD", n = [], o = [], i = [], a = [], l = [], c = 0;
      for (let p = 0; p < e.length; ++p) {
        let u = e[p];
        a.push(u), l.push(p);
        let _ = this.decode(a, { decode_with_timestamps: true });
        (!_.includes(r) || s[c + _.indexOf(r)] === r) && (n.push(_), o.push(a), i.push(l), a = [], l = [], c += _.length);
      }
      return [n, o, i];
    }
    splitTokensOnSpaces(e) {
      let [s, r, n] = this.splitTokensOnUnicode(e), o = [], i = [], a = [];
      for (let l = 0; l < s.length; ++l) {
        let c = s[l], p = r[l], u = n[l], _ = p[0] >= this._tokenizer.token_to_id("<|endoftext|>"), d = c.startsWith(" "), m = c.trim(), f = sb.test(m);
        if (_ || d || f || o.length === 0) o.push(c), i.push(p), a.push(u);
        else {
          let g = o.length - 1;
          o[g] += c, i[g].push(...p), a[g].push(...u);
        }
      }
      return [o, i, a];
    }
    mergePunctuations(e, s, r, n, o) {
      let i = structuredClone(e), a = structuredClone(s), l = structuredClone(r), c = i.length - 2, p = i.length - 1;
      for (; c >= 0; ) i[c].startsWith(" ") && n.includes(i[c].trim()) ? (i[p] = i[c] + i[p], a[p] = Fe(a[c], a[p]), l[p] = Fe(l[c], l[p]), i[c] = "", a[c] = [], l[c] = []) : p = c, --c;
      for (c = 0, p = 1; p < i.length; ) !i[c].endsWith(" ") && o.includes(i[p]) ? (i[c] += i[p], a[c] = Fe(a[c], a[p]), l[c] = Fe(l[c], l[p]), i[p] = "", a[p] = [], l[p] = []) : c = p, ++p;
      return [i.filter((u) => u), a.filter((u) => u.length > 0), l.filter((u) => u.length > 0)];
    }
  };
  var Zp = class extends P {
  };
  var eu = class extends P {
    constructor(e, s) {
      super(e, s);
      __publicField(this, "return_token_type_ids", true);
      F.warn('WARNING: `XLMTokenizer` is not yet supported by Hugging Face\'s "fast" tokenizers library. Therefore, you may experience slightly inaccurate results.');
    }
  };
  var W = class {
    static async from_pretrained(e, { progress_callback: s = null, config: r = null, cache_dir: n = null, local_files_only: o = false, revision: i = "main" } = {}) {
      let [a, l] = await lp(e, { progress_callback: s, config: r, cache_dir: n, local_files_only: o, revision: i }), c = l.tokenizer_class?.replace(/Fast$/, "") ?? "PreTrainedTokenizer", p = tu[c];
      return p || (F.warn(`Unknown tokenizer class "${c}", attempting to construct from base class.`), p = P), new p(a, l);
    }
  };
  var $t = "https://github.com/huggingface/transformers.js/issues/new/choose";
  var Br = "preprocessor_config.json";
  var kt = Br;
  var ka = "processor_config.json";
  var va = "chat_template.jinja";
  var _a5;
  var U = (_a5 = class extends xe {
    constructor(e, s, r) {
      super(), this.config = e, this.components = s, this.chat_template = r;
    }
    get image_processor() {
      return this.components.image_processor;
    }
    get tokenizer() {
      return this.components.tokenizer;
    }
    get feature_extractor() {
      return this.components.feature_extractor;
    }
    apply_chat_template(e, s = {}) {
      if (!this.tokenizer) throw new Error("Unable to apply chat template without a tokenizer.");
      return this.tokenizer.apply_chat_template(e, { tokenize: false, chat_template: this.chat_template ?? void 0, ...s });
    }
    batch_decode(...e) {
      if (!this.tokenizer) throw new Error("Unable to decode without a tokenizer.");
      return this.tokenizer.batch_decode(...e);
    }
    decode(...e) {
      if (!this.tokenizer) throw new Error("Unable to decode without a tokenizer.");
      return this.tokenizer.decode(...e);
    }
    async _call(e, ...s) {
      for (let r of [this.image_processor, this.feature_extractor, this.tokenizer]) if (r) return r(e, ...s);
      throw new Error("No image processor, feature extractor, or tokenizer found.");
    }
    static async from_pretrained(e, s = {}) {
      let [r, n, o] = await Promise.all([this.uses_processor_config ? Oe(e, ka, true, s) : {}, Promise.all(this.classes.filter((i) => i in this).map(async (i) => {
        let a = await this[i].from_pretrained(e, s);
        return [i.replace(/_class$/, ""), a];
      })).then(Object.fromEntries), this.uses_chat_template_file ? Lr(e, va, true, s) : null]);
      return new this(r, n, o);
    }
  }, __publicField(_a5, "classes", ["image_processor_class", "tokenizer_class", "feature_extractor_class"]), __publicField(_a5, "uses_processor_config", false), __publicField(_a5, "uses_chat_template_file", false), _a5);
  var Xa = {};
  Os(Xa, { ChatterboxProcessor: () => gu, CohereAsrProcessor: () => xu, Florence2Processor: () => p_, Gemma3Processor: () => u_, Gemma3nProcessor: () => __, Gemma4Processor: () => d_, Glm46VProcessor: () => m_, GraniteSpeechProcessor: () => f_, GroundingDinoProcessor: () => h_, Idefics3Processor: () => Wa, JinaCLIPProcessor: () => x_, Lfm2VlProcessor: () => w_, LlavaProcessor: () => y_, MgpstrProcessor: () => b_, MoonshineProcessor: () => k_, OwlViTProcessor: () => v_, PaliGemmaProcessor: () => E_, Phi3VProcessor: () => A_, PixtralProcessor: () => M_, Processor: () => U, PyAnnoteProcessor: () => S_, Qwen2VLProcessor: () => ls, Qwen2_5_VLProcessor: () => en, Qwen3VLProcessor: () => O_, Sam2Processor: () => Va, Sam2VideoProcessor: () => I_, SamProcessor: () => tn, SmolVLMProcessor: () => Wa, SpeechT5Processor: () => z_, UltravoxProcessor: () => T_, VLChatProcessor: () => g_, VoxtralProcessor: () => C_, VoxtralRealtimeProcessor: () => N_, Wav2Vec2Processor: () => L_, Wav2Vec2ProcessorWithLM: () => $_, WhisperProcessor: () => F_ });
  var le = class extends xe {
    constructor(e) {
      super(), this.config = e;
    }
    static async from_pretrained(e, s = {}) {
      let r = await Oe(e, Br, true, s);
      return new this(r);
    }
  };
  function ce(t6, e) {
    if (!(t6 instanceof Float32Array || t6 instanceof Float64Array)) throw new Error(`${e} expects input to be a Float32Array or a Float64Array, but got ${t6?.constructor?.name ?? typeof t6} instead. If using the feature extractor directly, remember to use \`read_audio(url, sampling_rate)\` to obtain the raw audio data of the file/url.`);
  }
  var Qr = {};
  Os(Qr, { ASTFeatureExtractor: () => nu, ChatterboxFeatureExtractor: () => ou, ClapFeatureExtractor: () => iu, CohereAsrFeatureExtractor: () => au, DacFeatureExtractor: () => Vr, EncodecFeatureExtractor: () => Gr, FeatureExtractor: () => le, Gemma3nAudioFeatureExtractor: () => Hr, Gemma4AudioFeatureExtractor: () => Kr, GraniteSpeechFeatureExtractor: () => lu, MoonshineFeatureExtractor: () => cu, ParakeetFeatureExtractor: () => Wr, PyAnnoteFeatureExtractor: () => Xr, SeamlessM4TFeatureExtractor: () => pu, SnacFeatureExtractor: () => uu, SpeechT5FeatureExtractor: () => _u, VoxtralRealtimeFeatureExtractor: () => fu, Wav2Vec2FeatureExtractor: () => du, WeSpeakerFeatureExtractor: () => mu, WhisperFeatureExtractor: () => hu });
  var fA = () => {
  };
  var rb = { fromWeb: fA };
  var hA = () => {
  };
  var nb = hA;
  async function Ea(t6, e) {
    if (K.IS_BROWSER_ENV) {
      if (K.IS_WEBWORKER_ENV) throw new Error("Unable to save a file from a Web Worker.");
      let s = URL.createObjectURL(e), r = document.createElement("a");
      r.href = s, r.download = t6, r.click(), r.remove(), URL.revokeObjectURL(s);
    } else if (K.IS_FS_AVAILABLE) {
      let s = e.stream(), r = rb.fromWeb(s), n = $e.createWriteStream(t6);
      await nb(r, n);
    } else throw new Error("Unable to save because filesystem is disabled in this environment.");
  }
  async function ru(t6, e) {
    if (typeof AudioContext > "u") throw Error("Unable to load audio from path/URL since `AudioContext` is not available in your environment. Instead, audio data should be passed directly to the pipeline/processor. For more information and some example code, see https://huggingface.co/docs/transformers.js/guides/node-audio-processing.");
    let s = await (await Tt(t6)).arrayBuffer(), r = new AudioContext({ sampleRate: e });
    typeof e > "u" && F.warn(`No sampling rate provided, using default of ${r.sampleRate}Hz.`);
    let n = await r.decodeAudioData(s), o;
    if (n.numberOfChannels === 2) {
      let i = Math.sqrt(2), a = n.getChannelData(0), l = n.getChannelData(1);
      o = new Float32Array(a.length);
      for (let c = 0; c < n.length; ++c) o[c] = i * (a[c] + l[c]) / 2;
    } else o = n.getChannelData(0);
    return o;
  }
  function ab(t6, e) {
    if (t6 < 1) return new Float64Array();
    if (t6 === 1) return new Float64Array([1]);
    let s = 1 - e, r = 2 * Math.PI / (t6 - 1), n = new Float64Array(t6);
    for (let o = 0; o < t6; ++o) n[o] = e - s * Math.cos(o * r);
    return n;
  }
  function ob(t6) {
    return ab(t6, 0.5);
  }
  function gA(t6) {
    return ab(t6, 0.54);
  }
  var xA = { htk: (t6) => 2595 * Math.log10(1 + t6 / 700), kaldi: (t6) => 1127 * Math.log(1 + t6 / 700), slaney: (t6, e = 1e3, s = 15, r = 27 / Math.log(6.4)) => t6 >= e ? s + Math.log(t6 / e) * r : 3 * t6 / 200 };
  function su(t6, e = "htk") {
    let s = xA[e];
    if (!s) throw new Error('mel_scale should be one of "htk", "slaney" or "kaldi".');
    return typeof t6 == "number" ? s(t6) : t6.map((r) => s(r));
  }
  var wA = { htk: (t6) => 700 * (10 ** (t6 / 2595) - 1), kaldi: (t6) => 700 * (Math.exp(t6 / 1127) - 1), slaney: (t6, e = 1e3, s = 15, r = Math.log(6.4) / 27) => t6 >= s ? e * Math.exp(r * (t6 - s)) : 200 * t6 / 3 };
  function yA(t6, e = "htk") {
    let s = wA[e];
    if (!s) throw new Error('mel_scale should be one of "htk", "slaney" or "kaldi".');
    return typeof t6 == "number" ? s(t6) : t6.map((r) => s(r));
  }
  function bA(t6, e) {
    let s = Float64Array.from({ length: e.length - 1 }, (i, a) => e[a + 1] - e[a]), r = Array.from({ length: t6.length }, () => new Array(e.length));
    for (let i = 0; i < t6.length; ++i) {
      let a = r[i];
      for (let l = 0; l < e.length; ++l) a[l] = e[l] - t6[i];
    }
    let n = e.length - 2, o = Array.from({ length: n }, () => new Array(t6.length));
    for (let i = 0; i < t6.length; ++i) {
      let a = r[i];
      for (let l = 0; l < n; ++l) {
        let c = -a[l] / s[l], p = a[l + 2] / s[l + 1];
        o[l][i] = Math.max(0, Math.min(c, p));
      }
    }
    return o;
  }
  function ib(t6, e, s) {
    let r = (e - t6) / (s - 1);
    return Float64Array.from({ length: s }, (n, o) => t6 + r * o);
  }
  function Ce(t6, e, s, r, n, o = null, i = "htk", a = false) {
    if (o !== null && o !== "slaney") throw new Error('norm must be one of null or "slaney"');
    if (t6 < 2) throw new Error(`Require num_frequency_bins: ${t6} >= 2`);
    if (s > r) throw new Error(`Require min_frequency: ${s} <= max_frequency: ${r}`);
    let l = su(s, i), c = su(r, i), p = ib(l, c, e + 2), u = yA(p, i), _;
    if (a) {
      let m = n / ((t6 - 1) * 2);
      _ = su(Float64Array.from({ length: t6 }, (f, g) => g * m), i), u = p;
    } else _ = ib(0, Math.floor(n / 2), t6);
    let d = bA(_, u);
    if (o !== null && o === "slaney") for (let m = 0; m < e; ++m) {
      let f = d[m], g = 2 / (u[m + 2] - u[m]);
      for (let x = 0; x < t6; ++x) f[x] *= g;
    }
    return d;
  }
  function kA(t6, e, s) {
    let r = new t6.constructor(t6.length + e + s), n = t6.length - 1;
    for (let o = 0; o < t6.length; ++o) r[e + o] = t6[o];
    for (let o = 1; o <= e; ++o) r[e - o] = t6[zs(o, n)];
    for (let o = 1; o <= s; ++o) r[n + e + o] = t6[zs(n - o, n)];
    return r;
  }
  function lb(t6, e, s, r, n) {
    if (s <= 0) throw new Error("reference must be greater than zero");
    if (r <= 0) throw new Error("min_value must be greater than zero");
    s = Math.max(r, s);
    let o = Math.log10(s);
    for (let i = 0; i < t6.length; ++i) t6[i] = e * Math.log10(Math.max(r, t6[i]) - o);
    if (n !== null) {
      if (n <= 0) throw new Error("db_range must be greater than zero");
      let i = de(t6)[0] - n;
      for (let a = 0; a < t6.length; ++a) t6[a] = Math.max(t6[a], i);
    }
    return t6;
  }
  function vA(t6, e = 1, s = 1e-5, r = null) {
    return lb(t6, 20, e, s, r);
  }
  function EA(t6, e = 1, s = 1e-10, r = null) {
    return lb(t6, 10, e, s, r);
  }
  async function Ie(t6, e, s, r, { fft_length: n = null, power: o = 1, center: i = true, pad_mode: a = "reflect", onesided: l = true, preemphasis: c = null, preemphasis_htk_flavor: p = true, mel_filters: u = null, mel_floor: _ = 1e-10, log_mel: d = null, max_log_mel: m = null, reference: f = 1, min_value: g = 1e-10, db_range: x = null, remove_dc_offset: w = null, min_num_frames: y = null, max_num_frames: b = null, do_pad: v = true, transpose: k = false, mel_offset: S = 0, mel_floor_mode: I = "clamp" } = {}) {
    let $ = e.length;
    if (n === null && (n = s), s > n) throw Error(`frame_length (${s}) may not be larger than fft_length (${n})`);
    if ($ !== s) throw new Error(`Length of the window (${$}) must equal frame_length (${s})`);
    if (r <= 0) throw new Error("hop_length must be greater than zero");
    if (o === null && u !== null) throw new Error("You have provided `mel_filters` but `power` is `None`. Mel spectrogram computation is not yet supported for complex-valued spectrogram. Specify `power` to fix this issue.");
    if (!p) throw new Error("`preemphasis_htk_flavor=false` is not currently supported.");
    if (i) {
      let G = Math.floor(s / 2);
      switch (a) {
        case "reflect": {
          t6 = kA(t6, G, G);
          break;
        }
        case "constant": {
          let ee = new t6.constructor(t6.length + 2 * G);
          ee.set(t6, G), t6 = ee;
          break;
        }
        case "semicausal": {
          let ee = new t6.constructor(t6.length + G);
          ee.set(t6, G), t6 = ee;
          break;
        }
        default:
          throw new Error(`pad_mode="${a}" not implemented yet.`);
      }
    }
    let C = Math.floor(1 + Math.floor((t6.length - s) / r));
    y !== null && C < y && (C = y);
    let q = l ? Math.floor(n / 2) + 1 : n, D = C, B = C;
    b !== null && (b > C ? v && (B = b) : B = D = b);
    let H = new _a3(n), V = new Float64Array(n), Z = new Float64Array(H.outputBufferSize), R = new Float32Array(q * B);
    for (let G = 0; G < D; ++G) {
      let ee = G * r, Le = Math.min(t6.length - ee, s);
      Le !== s && V.fill(0, 0, s);
      for (let re = 0; re < Le; ++re) V[re] = t6[ee + re];
      if (w) {
        let re = 0;
        for (let He = 0; He < Le; ++He) re += V[He];
        let ut = re / Le;
        for (let He = 0; He < Le; ++He) V[He] -= ut;
      }
      if (c !== null) {
        for (let re = Le - 1; re >= 1; --re) V[re] -= c * V[re - 1];
        V[0] *= 1 - c;
      }
      for (let re = 0; re < e.length; ++re) V[re] *= e[re];
      H.realTransform(Z, V);
      for (let re = 0; re < q; ++re) {
        let ut = re << 1;
        R[re * B + G] = Z[ut] ** 2 + Z[ut + 1] ** 2;
      }
    }
    if (o !== null && o !== 2) {
      let G = o / 2;
      for (let ee = 0; ee < R.length; ++ee) R[ee] **= G;
    }
    let A = u.length, O = await Q0(new E("float32", u.flat(), [A, q]), new E("float32", R, [q, B]));
    k && (O = O.transpose(1, 0));
    let z = O.data;
    if (I === "add") for (let G = 0; G < z.length; ++G) z[G] = S + z[G] + _;
    else for (let G = 0; G < z.length; ++G) z[G] = S + Math.max(_, z[G]);
    if (o !== null && d !== null) {
      let G = Math.min(z.length, D * A);
      switch (d) {
        case "log":
          for (let ee = 0; ee < G; ++ee) z[ee] = Math.log(z[ee]);
          break;
        case "log10":
          for (let ee = 0; ee < G; ++ee) z[ee] = Math.log10(z[ee]);
          break;
        case "log10_max_norm": {
          for (let re = 0; re < G; ++re) z[re] = Math.log10(z[re]);
          let Le = (m ?? de(z)[0]) - 8;
          for (let re = 0; re < G; ++re) z[re] = (Math.max(z[re], Le) + 4) / 4;
          break;
        }
        case "dB":
          if (o === 1) vA(z, f, g, x);
          else if (o === 2) EA(z, f, g, x);
          else throw new Error(`Cannot use log_mel option '${d}' with power ${o}`);
          break;
        default:
          throw new Error(`log_mel must be one of null, 'log', 'log10', 'log10_max_norm', or 'dB'. Got '${d}'`);
      }
    }
    return O;
  }
  function Ne(t6, e, { periodic: s = true, frame_length: r = null, center: n = true } = {}) {
    let o = s ? t6 + 1 : t6, i;
    switch (e) {
      case "boxcar":
        i = new Float64Array(o).fill(1);
        break;
      case "hann":
      case "hann_window":
        i = ob(o);
        break;
      case "hamming":
        i = gA(o);
        break;
      case "povey":
        i = ob(o).map((c) => Math.pow(c, 0.85));
        break;
      default:
        throw new Error(`Unknown window type ${e}.`);
    }
    if (s && (i = i.subarray(0, t6)), r === null || t6 === r) return i;
    if (t6 > r) throw new Error(`Length of the window (${t6}) may not be larger than frame_length (${r})`);
    let a = new Float64Array(r), l = n ? Math.floor((r - t6) / 2) : 0;
    return a.set(i, l), a;
  }
  function AA(t6, e) {
    let s = t6.reduce((o, i) => o + i.length, 0), r = new ArrayBuffer(44), n = new DataView(r);
    return Aa(n, 0, "RIFF"), n.setUint32(4, 36 + s * 4, true), Aa(n, 8, "WAVE"), Aa(n, 12, "fmt "), n.setUint32(16, 16, true), n.setUint16(20, 3, true), n.setUint16(22, 1, true), n.setUint32(24, e, true), n.setUint32(28, e * 4, true), n.setUint16(32, 4, true), n.setUint16(34, 32, true), Aa(n, 36, "data"), n.setUint32(40, s * 4, true), new Blob([r, ...t6.map((o) => o.buffer)], { type: "audio/wav" });
  }
  function Aa(t6, e, s) {
    for (let r = 0; r < s.length; ++r) t6.setUint8(e + r, s.charCodeAt(r));
  }
  var Ur = class {
    constructor(e, s) {
      this.audio = e, this.sampling_rate = s;
    }
    get data() {
      if (Array.isArray(this.audio)) {
        if (this.audio.length === 0) return new Float32Array(0);
        if (this.audio.length === 1) return this.audio[0];
        let e = this.audio.reduce((n, o) => n + o.length, 0), s = new Float32Array(e), r = 0;
        for (let n of this.audio) s.set(n, r), r += n.length;
        return s;
      } else return this.audio;
    }
    toBlob() {
      let e = this.audio;
      return e instanceof Float32Array && (e = [e]), AA(e, this.sampling_rate);
    }
    async save(e) {
      return Ea(e, this.toBlob());
    }
  };
  var nu = class extends le {
    constructor(e) {
      super(e);
      let s = this.config.sampling_rate, r = Ce(257, this.config.num_mel_bins, 20, Math.floor(s / 2), s, null, "kaldi", true);
      this.mel_filters = r, this.window = Ne(400, "hann", { periodic: false }), this.mean = this.config.mean, this.std = this.config.std;
    }
    async _extract_fbank_features(e, s) {
      return Ie(e, this.window, 400, 160, { fft_length: 512, power: 2, center: false, preemphasis: 0.97, mel_filters: this.mel_filters, log_mel: "log", mel_floor: 1192092955078125e-22, remove_dc_offset: true, max_num_frames: s, transpose: true });
    }
    async _call(e) {
      ce(e, "ASTFeatureExtractor");
      let s = await this._extract_fbank_features(e, this.config.max_length);
      if (this.config.do_normalize) {
        let r = this.std * 2, n = s.data;
        for (let o = 0; o < n.length; ++o) n[o] = (n[o] - this.mean) / r;
      }
      return { input_values: s.unsqueeze_(0) };
    }
  };
  var Gr = class extends le {
    async _call(e) {
      ce(e, "EncodecFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
      let s = this.config.feature_size;
      if (e.length % s !== 0) throw new Error(`The length of the audio data must be a multiple of the number of channels (${s}).`);
      let r = [1, s, e.length / s];
      return { input_values: new E("float32", e, r) };
    }
  };
  var ou = class extends le {
    async _call(e) {
      ce(e, "ChatterboxFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
      let s = [1, e.length];
      return { input_values: new E("float32", e, s) };
    }
  };
  var iu = class extends le {
    constructor(e) {
      super(e), this.mel_filters = Ce(this.config.nb_frequency_bins, this.config.feature_size, this.config.frequency_min, this.config.frequency_max, this.config.sampling_rate, null, "htk"), this.mel_filters_slaney = Ce(this.config.nb_frequency_bins, this.config.feature_size, this.config.frequency_min, this.config.frequency_max, this.config.sampling_rate, "slaney", "slaney"), this.window = Ne(this.config.fft_window_size, "hann");
    }
    async _get_input_mel(e, s, r, n) {
      let o, i = false, a = e.length - s;
      if (a > 0) if (r === "rand_trunc") {
        i = true;
        let l = Math.floor(ns.random() * (a + 1));
        e = e.subarray(l, l + s), o = await this._extract_fbank_features(e, this.mel_filters_slaney, this.config.nb_max_samples);
      } else throw new Error(`Truncation strategy "${r}" not implemented`);
      else {
        if (a < 0) {
          let l = new Float64Array(s);
          if (l.set(e), n === "repeat") for (let c = e.length; c < s; c += e.length) l.set(e.subarray(0, Math.min(e.length, s - c)), c);
          else if (n === "repeatpad") for (let c = e.length; c < -a; c += e.length) l.set(e, c);
          e = l;
        }
        if (r === "fusion") throw new Error(`Truncation strategy "${r}" not implemented`);
        o = await this._extract_fbank_features(e, this.mel_filters_slaney, this.config.nb_max_samples);
      }
      return o.unsqueeze_(0);
    }
    async _extract_fbank_features(e, s, r = null) {
      return Ie(e, this.window, this.config.fft_window_size, this.config.hop_length, { power: 2, mel_filters: s, log_mel: "dB", max_num_frames: r, do_pad: false, transpose: true });
    }
    async _call(e, { max_length: s = null } = {}) {
      return ce(e, "ClapFeatureExtractor"), { input_features: (await this._get_input_mel(e, s ?? this.config.nb_max_samples, this.config.truncation, this.config.padding)).unsqueeze_(0) };
    }
  };
  var MA = 1e-5;
  var Wr = class extends le {
    constructor(e) {
      var _a68;
      super(e), (_a68 = this.config).mel_filters ?? (_a68.mel_filters = Ce(Math.floor(1 + this.config.n_fft / 2), this.config.feature_size, 0, this.config.sampling_rate / 2, this.config.sampling_rate, "slaney", "slaney"));
      let s = Ne(this.config.win_length, "hann", { periodic: false });
      this.window = new Float64Array(this.config.n_fft);
      let r = Math.floor((this.config.n_fft - this.config.win_length) / 2);
      this.window.set(s, r);
    }
    async _extract_fbank_features(e) {
      let s = this.config.preemphasis;
      e = new Float64Array(e);
      for (let n = e.length - 1; n >= 1; --n) e[n] -= s * e[n - 1];
      return await Ie(e, this.window, this.window.length, this.config.hop_length, { fft_length: this.config.n_fft, power: 2, mel_filters: this.config.mel_filters, log_mel: "log", mel_floor: -1 / 0, pad_mode: "constant", center: true, transpose: true, mel_offset: 2 ** -24 });
    }
    async _call(e) {
      ce(e, "ParakeetFeatureExtractor");
      let s = await this._extract_fbank_features(e), r = Math.floor((e.length + Math.floor(this.config.n_fft / 2) * 2 - this.config.n_fft) / this.config.hop_length), n = s.data;
      n.fill(0, r * s.dims[1]);
      let [o, i] = s.dims, a = new Float64Array(i), l = new Float64Array(i);
      for (let u = 0; u < r; ++u) {
        let _ = u * i;
        for (let d = 0; d < i; ++d) {
          let m = n[_ + d];
          a[d] += m, l[d] += m * m;
        }
      }
      let c = r > 1 ? r - 1 : 1;
      for (let u = 0; u < i; ++u) {
        let _ = a[u] / r, d = (l[u] - r * _ * _) / c, f = 1 / (Math.sqrt(d) + MA);
        for (let g = 0; g < r; ++g) {
          let x = g * i + u;
          n[x] = (n[x] - _) * f;
        }
      }
      let p = new BigInt64Array(o);
      return p.fill(1n, 0, r), { input_features: s.unsqueeze_(0), attention_mask: new E("int64", p, [1, o]) };
    }
  };
  var au = class extends Wr {
    _apply_dither(e) {
      let s = this.config.dither ?? 0;
      if (s <= 0) return e;
      let r = new It(e.length);
      for (let n = 0; n < e.length; ++n) e[n] += s * r.gauss();
      return e;
    }
    split_audio(e) {
      let s = this.config.max_audio_clip_s ?? 35, r = this.config.overlap_chunk_second ?? 5, n = this.config.min_energy_window_samples ?? 1600, o = this.config.sampling_rate, i = Math.max(1, Math.round(s * o)), a = Math.max(1, Math.round(r * o));
      if (e.length <= i) return [e];
      let l = [], c = 0, p = e.length;
      for (; c < p; ) {
        if (c + i >= p) {
          l.push(e.slice(c, p));
          break;
        }
        let u = Math.max(c, c + i - a), _ = Math.min(c + i, p), d;
        _ <= u ? d = c + i : d = this._find_split_point_energy(e, u, _, n), d = Math.max(c + 1, Math.min(d, p)), l.push(e.slice(c, d)), c = d;
      }
      return l;
    }
    _find_split_point_energy(e, s, r, n) {
      let o = r - s;
      if (o <= n) return Math.floor((s + r) / 2);
      let i = 1 / 0, a = s, l = o - n;
      for (let c = 0; c <= l; c += n) {
        let p = 0;
        for (let u = 0; u < n; ++u) {
          let _ = e[s + c + u];
          p += _ * _;
        }
        p = Math.sqrt(p / n), p < i && (i = p, a = s + c);
      }
      return a;
    }
    async _call(e) {
      ce(e, "CohereAsrFeatureExtractor");
      let s = new Float64Array(e);
      return this._apply_dither(s), super._call(s);
    }
  };
  var Vr = class extends Gr {
  };
  var Hr = class extends le {
    constructor(e) {
      super(e);
      let { fft_length: s, feature_size: r, min_frequency: n, max_frequency: o, sampling_rate: i, frame_length: a } = this.config, l = Ce(Math.floor(1 + s / 2), r, n, o, i, null, "htk", false);
      this.mel_filters = l, this.window = Ne(a, "hann");
    }
    async _extract_fbank_features(e, s) {
      return Ie(e, this.window, this.config.frame_length, this.config.hop_length, { fft_length: this.config.fft_length, center: false, onesided: true, preemphasis: this.config.preemphasis, preemphasis_htk_flavor: this.config.preemphasis_htk_flavor, mel_filters: this.mel_filters, log_mel: "log", mel_floor: this.config.mel_floor, remove_dc_offset: false, transpose: true });
    }
    async _call(e, { max_length: s = 48e4, truncation: r = true, padding: n = true, pad_to_multiple_of: o = 128 } = {}) {
      if (ce(e, "Gemma3nAudioFeatureExtractor"), r && e.length > s && (e = e.slice(0, s)), n && e.length % o !== 0) {
        let l = o - e.length % o, c = new Float64Array(e.length + l);
        c.set(e), this.config.padding_value !== 0 && c.fill(this.config.padding_value, e.length), e = c;
      }
      let i = await this._extract_fbank_features(e, this.config.max_length), a = ke([1, i.dims[0]], true);
      return { input_features: i.unsqueeze_(0), input_features_mask: a };
    }
  };
  var Kr = class extends Hr {
    async _extract_fbank_features(e, s) {
      let { frame_length: r, hop_length: n, fft_length: o } = this.config, i = Math.floor(r / 2), a = Math.floor((e.length + i - (r + 1)) / n) + 1;
      return Ie(e, this.window, r, n, { fft_length: o, center: true, pad_mode: "semicausal", onesided: true, preemphasis: this.config.preemphasis, preemphasis_htk_flavor: this.config.preemphasis_htk_flavor, mel_filters: this.mel_filters, log_mel: "log", mel_floor: this.config.mel_floor, mel_floor_mode: "add", remove_dc_offset: false, transpose: true, max_num_frames: a });
    }
    async _call(e, s = {}) {
      ce(e, "Gemma4AudioFeatureExtractor");
      let r = e.length, n = await super._call(e, s), { input_features: o } = n, [, i, a] = o.dims, { frame_length: l, hop_length: c } = this.config, p = Math.floor(l / 2), u = l + 1, _ = new Uint8Array(r + p + (s.pad_to_multiple_of ?? 128));
      _.fill(1, p, p + r);
      let d = new Uint8Array(i);
      for (let f = 0; f < i; ++f) d[f] = _[f * c + u - 1] ? 1 : 0;
      let m = o.data;
      for (let f = 0; f < i; ++f) d[f] || m.fill(0, f * a, (f + 1) * a);
      return n.input_features_mask = new E("bool", d, [1, i]), n;
    }
  };
  var lu = class extends le {
    constructor(e) {
      super(e);
      let { n_fft: s, win_length: r, n_mels: n, sample_rate: o } = e.melspec_kwargs;
      this.mel_filters = Ce(Math.floor(1 + s / 2), n, 0, o / 2, o, null, "htk");
      let i = Ne(r, "hann");
      this.window = new Float64Array(s);
      let a = Math.floor((s - r) / 2);
      this.window.set(i, a);
    }
    async _call(e) {
      ce(e, "GraniteSpeechFeatureExtractor");
      let { n_fft: s, hop_length: r, n_mels: n } = this.config.melspec_kwargs, o = 1 + Math.floor((e.length - 1) / r), i = o - o % 2;
      return { input_features: (await Ie(e, this.window, s, r, { power: 2, mel_filters: this.mel_filters, log_mel: "log10_max_norm", transpose: true, max_num_frames: i, do_pad: false })).view(-1, 2 * n).unsqueeze_(0) };
    }
  };
  var cu = class extends le {
    async _call(e) {
      ce(e, "MoonshineFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
      let s = [1, e.length];
      return { input_values: new E("float32", e, s) };
    }
  };
  var Xr = class extends le {
    async _call(e) {
      ce(e, "PyAnnoteFeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
      let s = [1, 1, e.length];
      return { input_values: new E("float32", e, s) };
    }
    samples_to_frames(e) {
      return (e - this.config.offset) / this.config.step;
    }
    post_process_speaker_diarization(e, s) {
      let r = s / this.samples_to_frames(s) / this.config.sampling_rate, n = [];
      for (let o of e.tolist()) {
        let i = [], a = -1;
        for (let l = 0; l < o.length; ++l) {
          let c = fe(o[l]), [p, u] = de(c), [_, d] = [l, l + 1];
          u !== a ? (a = u, i.push({ id: u, start: _, end: d, score: p })) : (i.at(-1).end = d, i.at(-1).score += p);
        }
        n.push(i.map(({ id: l, start: c, end: p, score: u }) => ({ id: l, start: c * r, end: p * r, confidence: u / (p - c) })));
      }
      return n;
    }
  };
  var pu = class extends le {
    constructor(e) {
      super(e);
      let s = this.config.sampling_rate, r = Ce(257, this.config.num_mel_bins, 20, Math.floor(s / 2), s, null, "kaldi", true);
      this.mel_filters = r, this.window = Ne(400, "povey", { periodic: false });
    }
    async _extract_fbank_features(e, s) {
      return e = e.map((r) => r * 32768), Ie(e, this.window, 400, 160, { fft_length: 512, power: 2, center: false, preemphasis: 0.97, mel_filters: this.mel_filters, log_mel: "log", mel_floor: 1192092955078125e-22, remove_dc_offset: true, max_num_frames: s, transpose: true });
    }
    async _call(e, { padding: s = true, pad_to_multiple_of: r = 2, do_normalize_per_mel_bins: n = true, return_attention_mask: o = true } = {}) {
      ce(e, "SeamlessM4TFeatureExtractor");
      let i = await this._extract_fbank_features(e, this.config.max_length);
      if (n) {
        let [m, f] = i.dims, g = i.data;
        for (let x = 0; x < f; ++x) {
          let w = 0;
          for (let k = 0; k < m; ++k) w += g[k * f + x];
          let y = w / m, b = 0;
          for (let k = 0; k < m; ++k) b += (g[k * f + x] - y) ** 2;
          b /= m - 1;
          let v = Math.sqrt(b + 1e-7);
          for (let k = 0; k < m; ++k) {
            let S = k * f + x;
            g[S] = (g[S] - y) / v;
          }
        }
      }
      let a;
      if (s) {
        let [m, f] = i.dims, g = i.data, x = m % r;
        if (x > 0) {
          let w = new Float32Array(f * (m + x));
          w.set(g), w.fill(this.config.padding_value, g.length);
          let y = m + x;
          i = new E(i.type, w, [y, f]), o && (a = new E("int64", new BigInt64Array(y), [1, y]), a.data.fill(1n, 0, m));
        }
      }
      let [l, c] = i.dims, p = this.config.stride;
      if (l % p !== 0) throw new Error(`The number of frames (${l}) must be a multiple of the stride (${p}).`);
      let _ = i.view(1, Math.floor(l / p), c * p), d = { input_features: _ };
      if (o) {
        let m = _.dims[1], f = new BigInt64Array(m);
        if (a) {
          let g = a.data;
          for (let x = 1, w = 0; x < l; x += p, ++w) f[w] = g[x];
        } else f.fill(1n);
        d.attention_mask = new E("int64", f, [1, m]);
      }
      return d;
    }
  };
  var uu = class extends Vr {
  };
  var _u = class extends le {
  };
  var du = class extends le {
    _zero_mean_unit_var_norm(e) {
      let r = e.reduce((o, i) => o + i, 0) / e.length, n = e.reduce((o, i) => o + (i - r) ** 2, 0) / e.length;
      return e.map((o) => (o - r) / Math.sqrt(n + 1e-7));
    }
    async _call(e) {
      ce(e, "Wav2Vec2FeatureExtractor"), e instanceof Float64Array && (e = new Float32Array(e));
      let s = e;
      this.config.do_normalize && (s = this._zero_mean_unit_var_norm(s));
      let r = [1, s.length];
      return { input_values: new E("float32", s, r), attention_mask: new E("int64", new BigInt64Array(s.length).fill(1n), r) };
    }
  };
  var mu = class extends le {
    constructor(e) {
      super(e);
      let s = this.config.sampling_rate, r = Ce(257, this.config.num_mel_bins, 20, Math.floor(s / 2), s, null, "kaldi", true);
      this.mel_filters = r, this.window = Ne(400, "hamming", { periodic: false }), this.min_num_frames = this.config.min_num_frames;
    }
    async _extract_fbank_features(e) {
      return e = e.map((s) => s * 32768), Ie(e, this.window, 400, 160, { fft_length: 512, power: 2, center: false, preemphasis: 0.97, mel_filters: this.mel_filters, log_mel: "log", mel_floor: 1192092955078125e-22, remove_dc_offset: true, transpose: true, min_num_frames: this.min_num_frames });
    }
    async _call(e) {
      ce(e, "WeSpeakerFeatureExtractor");
      let s = (await this._extract_fbank_features(e)).unsqueeze_(0);
      if (this.config.fbank_centering_span === null) {
        let r = s.mean(1).data, n = s.data, [o, i, a] = s.dims;
        for (let l = 0; l < o; ++l) {
          let c = l * i * a, p = l * a;
          for (let u = 0; u < i; ++u) {
            let _ = c + u * a;
            for (let d = 0; d < a; ++d) n[_ + d] -= r[p + d];
          }
        }
      }
      return { input_features: s };
    }
  };
  var fu = class extends le {
    constructor(e) {
      var _a68;
      super(e), (_a68 = this.config).mel_filters ?? (_a68.mel_filters = Ce(Math.floor(1 + this.config.n_fft / 2), this.config.feature_size, 0, 8e3, this.config.sampling_rate, "slaney", "slaney")), this.window = Ne(this.config.n_fft, "hann");
    }
    async _extract_fbank_features(e, { center: s = true } = {}) {
      let { n_fft: r, hop_length: n, mel_filters: o, global_log_mel_max: i } = this.config, a = Math.floor(s ? e.length / n : (e.length - r) / n);
      return await Ie(e, this.window, r, n, { power: 2, mel_filters: o, log_mel: "log10_max_norm", max_log_mel: i, center: s, max_num_frames: a, do_pad: false });
    }
    async _call(e, { center: s = true } = {}) {
      return ce(e, "VoxtralRealtimeFeatureExtractor"), { input_features: (await this._extract_fbank_features(e, { center: s })).unsqueeze_(0) };
    }
  };
  var hu = class extends le {
    constructor(e) {
      var _a68;
      super(e), (_a68 = this.config).mel_filters ?? (_a68.mel_filters = Ce(Math.floor(1 + this.config.n_fft / 2), this.config.feature_size, 0, 8e3, this.config.sampling_rate, "slaney", "slaney")), this.window = Ne(this.config.n_fft, "hann");
    }
    async _extract_fbank_features(e) {
      return await Ie(e, this.window, this.config.n_fft, this.config.hop_length, { power: 2, mel_filters: this.config.mel_filters, log_mel: "log10_max_norm", max_num_frames: Math.min(Math.floor(e.length / this.config.hop_length), this.config.nb_max_frames) });
    }
    async _call(e, { max_length: s = null } = {}) {
      ce(e, "WhisperFeatureExtractor");
      let r, n = s ?? this.config.n_samples;
      return e.length > n ? (e.length > this.config.n_samples && F.warn("Attempting to extract features for audio longer than 30 seconds. If using a pipeline to extract transcript from a long audio clip, remember to specify `chunk_length_s` and/or `stride_length_s`."), r = e.slice(0, n)) : (r = new Float32Array(n), r.set(e)), { input_features: (await this._extract_fbank_features(r)).unsqueeze_(0) };
    }
  };
  var ge = class {
    static async from_pretrained(e, s = {}) {
      let r = await Oe(e, Br, true, s), n = r.feature_extractor_type, o = Qr[n];
      if (!o) throw new Error(`Unknown feature_extractor_type: '${n}'. Please report this at ${$t}.`);
      return new o(r);
    }
  };
  var _a6;
  var gu = (_a6 = class extends U {
    async _call(e, s = null) {
      let r = this.tokenizer(e), n = s ? await this.feature_extractor(s) : {};
      return { ...r, ...n };
    }
  }, __publicField(_a6, "tokenizer_class", W), __publicField(_a6, "feature_extractor_class", ge), _a6);
  var SA = /* @__PURE__ */ new Set(["ja", "zh"]);
  var _a7;
  var xu = (_a7 = class extends U {
    get_decoder_prompt_ids(e = "en") {
      let s = ["\u2581", "<|startofcontext|>", "<|startoftranscript|>", "<|emo:undefined|>", `<|${e}|>`, `<|${e}|>`, "<|pnc|>", "<|noitn|>", "<|notimestamp|>", "<|nodiarize|>"];
      return this.tokenizer.convert_tokens_to_ids(s);
    }
    static join_chunks(e, s = "en") {
      let r = e.filter((i) => i && i.trim());
      if (r.length === 0) return "";
      let n = SA.has(s) ? "" : " ";
      return [r[0].trimEnd(), ...r.slice(1).map((i) => i.trim())].join(n);
    }
    async _call(e) {
      return await this.feature_extractor(e);
    }
  }, __publicField(_a7, "tokenizer_class", W), __publicField(_a7, "feature_extractor_class", ge), __publicField(_a7, "uses_processor_config", true), _a7);
  var Ma = {};
  var as;
  var cb;
  var Ft;
  if (K.IS_WEB_ENV) as = (t6, e) => {
    if (!self.OffscreenCanvas) throw new Error("OffscreenCanvas not supported by this environment.");
    return new self.OffscreenCanvas(t6, e);
  }, Ft = self.createImageBitmap, cb = self.ImageData;
  else if (Ma) Ft = async (t6) => {
    let s = (await t6.metadata()).channels, { data: r, info: n } = await t6.rotate().raw().toBuffer({ resolveWithObject: true }), o = new Ee(new Uint8ClampedArray(r), n.width, n.height, n.channels);
    return s !== void 0 && s !== n.channels && o.convert(s), o;
  };
  else throw new Error("Unable to load image processing library.");
  var OA = { 0: "nearest", 1: "lanczos", 2: "bilinear", 3: "bicubic", 4: "box", 5: "hamming" };
  var IA = /* @__PURE__ */ new Map([["png", "image/png"], ["jpg", "image/jpeg"], ["jpeg", "image/jpeg"], ["gif", "image/gif"]]);
  var Ee = class t3 {
    constructor(e, s, r, n) {
      this.data = e, this.width = s, this.height = r, this.channels = n;
    }
    get size() {
      return [this.width, this.height];
    }
    static async read(e) {
      if (e instanceof t3) return e;
      if (typeof e == "string" || e instanceof URL) return await this.fromURL(e);
      if (e instanceof Blob) return await this.fromBlob(e);
      if (typeof HTMLCanvasElement < "u" && e instanceof HTMLCanvasElement || typeof OffscreenCanvas < "u" && e instanceof OffscreenCanvas) return this.fromCanvas(e);
      throw new Error(`Unsupported input type: ${typeof e}`);
    }
    static fromCanvas(e) {
      if (!K.IS_WEB_ENV) throw new Error("fromCanvas() is only supported in browser environments.");
      let r = e.getContext("2d").getImageData(0, 0, e.width, e.height).data;
      return new t3(r, e.width, e.height, 4);
    }
    static async fromURL(e) {
      let s = await Tt(e);
      if (s.status !== 200) throw new Error(`Unable to read image from "${e}" (${s.status} ${s.statusText})`);
      let r = await s.blob();
      return this.fromBlob(r);
    }
    static async fromBlob(e) {
      if (K.IS_WEB_ENV) {
        let s = await Ft(e), r = as(s.width, s.height).getContext("2d");
        return r.drawImage(s, 0, 0), new this(r.getImageData(0, 0, s.width, s.height).data, s.width, s.height, 4);
      } else {
        let s = Ma(await e.arrayBuffer());
        return await Ft(s);
      }
    }
    static fromTensor(e, s = "CHW") {
      if (e.dims.length !== 3) throw new Error(`Tensor should have 3 dimensions, but has ${e.dims.length} dimensions.`);
      if (s === "CHW") e = e.transpose(1, 2, 0);
      else if (s !== "HWC") throw new Error(`Unsupported channel format: ${s}`);
      if (!(e.data instanceof Uint8ClampedArray || e.data instanceof Uint8Array)) throw new Error(`Unsupported tensor type: ${e.type}`);
      switch (e.dims[2]) {
        case 1:
        case 2:
        case 3:
        case 4:
          return new t3(e.data, e.dims[1], e.dims[0], e.dims[2]);
        default:
          throw new Error(`Unsupported number of channels: ${e.dims[2]}`);
      }
    }
    grayscale() {
      if (this.channels === 1) return this;
      let e = new Uint8ClampedArray(this.width * this.height * 1);
      switch (this.channels) {
        case 3:
        case 4:
          for (let s = 0, r = 0; s < this.data.length; s += this.channels) {
            let n = this.data[s], o = this.data[s + 1], i = this.data[s + 2];
            e[r++] = Math.round(0.2989 * n + 0.587 * o + 0.114 * i);
          }
          break;
        default:
          throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
      }
      return this._update(e, this.width, this.height, 1);
    }
    rgb() {
      if (this.channels === 3) return this;
      let e = new Uint8ClampedArray(this.width * this.height * 3);
      switch (this.channels) {
        case 1:
          for (let s = 0, r = 0; s < this.data.length; ++s) e[r++] = this.data[s], e[r++] = this.data[s], e[r++] = this.data[s];
          break;
        case 4:
          for (let s = 0, r = 0; s < this.data.length; s += 4) e[r++] = this.data[s], e[r++] = this.data[s + 1], e[r++] = this.data[s + 2];
          break;
        default:
          throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
      }
      return this._update(e, this.width, this.height, 3);
    }
    rgba() {
      if (this.channels === 4) return this;
      let e = new Uint8ClampedArray(this.width * this.height * 4);
      switch (this.channels) {
        case 1:
          for (let s = 0, r = 0; s < this.data.length; ++s) e[r++] = this.data[s], e[r++] = this.data[s], e[r++] = this.data[s], e[r++] = 255;
          break;
        case 3:
          for (let s = 0, r = 0; s < this.data.length; s += 3) e[r++] = this.data[s], e[r++] = this.data[s + 1], e[r++] = this.data[s + 2], e[r++] = 255;
          break;
        default:
          throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
      }
      return this._update(e, this.width, this.height, 4);
    }
    putAlpha(e) {
      if (e.width !== this.width || e.height !== this.height) throw new Error(`Expected mask size to be ${this.width}x${this.height}, but got ${e.width}x${e.height}`);
      if (e.channels !== 1) throw new Error(`Expected mask to have 1 channel, but got ${e.channels}`);
      let s = this.data, r = e.data, n = this.width * this.height;
      if (this.channels === 3) {
        let o = new Uint8ClampedArray(n * 4);
        for (let i = 0, a = 0, l = 0; i < n; ++i) o[l++] = s[a++], o[l++] = s[a++], o[l++] = s[a++], o[l++] = r[i];
        return this._update(o, this.width, this.height, 4);
      } else if (this.channels === 4) {
        for (let o = 0; o < n; ++o) s[4 * o + 3] = r[o];
        return this;
      }
      throw new Error(`Expected image to have 3 or 4 channels, but got ${this.channels}`);
    }
    async resize(e, s, { resample: r = 2 } = {}) {
      if (this.width === e && this.height === s) return this;
      let n = OA[r] ?? r, o = jc(e), i = jc(s);
      if (o && i) return this;
      if (o ? e = s / this.height * this.width : i && (s = e / this.width * this.height), K.IS_WEB_ENV) {
        let a = this.channels, l = this.toCanvas(), c = as(e, s).getContext("2d");
        return c.drawImage(l, 0, 0, e, s), new t3(c.getImageData(0, 0, e, s).data, e, s, 4).convert(a);
      } else {
        let a = this.toSharp();
        switch (n) {
          case "box":
          case "hamming":
            (n === "box" || n === "hamming") && (F.warn(`Resampling method ${n} is not yet supported. Using bilinear instead.`), n = "bilinear");
          case "nearest":
          case "bilinear":
          case "bicubic":
            a = a.affine([e / this.width, 0, 0, s / this.height], { interpolator: n });
            break;
          case "lanczos":
            a = a.resize({ width: e, height: s, fit: "fill", kernel: "lanczos3" });
            break;
          default:
            throw new Error(`Resampling method ${n} is not supported.`);
        }
        return await Ft(a);
      }
    }
    async pad([e, s, r, n]) {
      if (e = Math.max(e, 0), s = Math.max(s, 0), r = Math.max(r, 0), n = Math.max(n, 0), e === 0 && s === 0 && r === 0 && n === 0) return this;
      if (K.IS_WEB_ENV) {
        let o = this.channels, i = this.toCanvas(), a = this.width + e + s, l = this.height + r + n, c = as(a, l).getContext("2d");
        return c.drawImage(i, 0, 0, this.width, this.height, e, r, this.width, this.height), new t3(c.getImageData(0, 0, a, l).data, a, l, 4).convert(o);
      } else {
        let o = this.toSharp().extend({ left: e, right: s, top: r, bottom: n });
        return await Ft(o);
      }
    }
    async crop([e, s, r, n]) {
      if (e = Math.max(e, 0), s = Math.max(s, 0), r = Math.min(r, this.width - 1), n = Math.min(n, this.height - 1), e === 0 && s === 0 && r === this.width - 1 && n === this.height - 1) return this;
      let o = r - e + 1, i = n - s + 1;
      if (K.IS_WEB_ENV) {
        let a = this.channels, l = this.toCanvas(), c = as(o, i).getContext("2d");
        return c.drawImage(l, e, s, o, i, 0, 0, o, i), new t3(c.getImageData(0, 0, o, i).data, o, i, 4).convert(a);
      } else {
        let a = this.toSharp().extract({ left: e, top: s, width: o, height: i });
        return await Ft(a);
      }
    }
    async center_crop(e, s) {
      if (this.width === e && this.height === s) return this;
      let r = (this.width - e) / 2, n = (this.height - s) / 2;
      if (K.IS_WEB_ENV) {
        let o = this.channels, i = this.toCanvas(), a = as(e, s).getContext("2d"), l = 0, c = 0, p = 0, u = 0;
        return r >= 0 ? l = r : p = -r, n >= 0 ? c = n : u = -n, a.drawImage(i, l, c, e, s, p, u, e, s), new t3(a.getImageData(0, 0, e, s).data, e, s, 4).convert(o);
      } else {
        let o = this.toSharp();
        if (r >= 0 && n >= 0) o = o.extract({ left: Math.floor(r), top: Math.floor(n), width: e, height: s });
        else if (r <= 0 && n <= 0) {
          let i = Math.floor(-n), a = Math.floor(-r);
          o = o.extend({ top: i, left: a, right: e - this.width - a, bottom: s - this.height - i });
        } else {
          let i = [0, 0], a = 0;
          n < 0 ? (i[0] = Math.floor(-n), i[1] = s - this.height - i[0]) : a = Math.floor(n);
          let l = [0, 0], c = 0;
          r < 0 ? (l[0] = Math.floor(-r), l[1] = e - this.width - l[0]) : c = Math.floor(r), o = o.extend({ top: i[0], bottom: i[1], left: l[0], right: l[1] }).extract({ left: c, top: a, width: e, height: s });
        }
        return await Ft(o);
      }
    }
    async toBlob(e = "image/png", s = 1) {
      if (!K.IS_WEB_ENV) throw new Error("toBlob() is only supported in browser environments.");
      return await this.toCanvas().convertToBlob({ type: e, quality: s });
    }
    toTensor(e = "CHW") {
      let s = new E("uint8", new Uint8Array(this.data), [this.height, this.width, this.channels]);
      if (e !== "HWC") if (e === "CHW") s = s.permute(2, 0, 1);
      else throw new Error(`Unsupported channel format: ${e}`);
      return s;
    }
    toCanvas() {
      if (!K.IS_WEB_ENV) throw new Error("toCanvas() is only supported in browser environments.");
      let e = this.clone().rgba(), s = as(e.width, e.height), r = new cb(e.data, e.width, e.height);
      return s.getContext("2d").putImageData(r, 0, 0), s;
    }
    split() {
      let { data: e, width: s, height: r, channels: n } = this, o = e.constructor, i = e.length / n, a = Array.from({ length: n }, () => new o(i));
      for (let l = 0; l < i; ++l) {
        let c = n * l;
        for (let p = 0; p < n; ++p) a[p][l] = e[c + p];
      }
      return a.map((l) => new t3(l, s, r, 1));
    }
    _update(e, s, r, n = null) {
      return this.data = e, this.width = s, this.height = r, n !== null && (this.channels = n), this;
    }
    clone() {
      return new t3(this.data.slice(), this.width, this.height, this.channels);
    }
    convert(e) {
      if (this.channels === e) return this;
      switch (e) {
        case 1:
          this.grayscale();
          break;
        case 3:
          this.rgb();
          break;
        case 4:
          this.rgba();
          break;
        default:
          throw new Error(`Conversion failed due to unsupported number of channels: ${this.channels}`);
      }
      return this;
    }
    async save(e) {
      if (K.IS_WEB_ENV) {
        if (K.IS_WEBWORKER_ENV) throw new Error("Unable to save an image from a Web Worker.");
        let s = e.split(".").pop().toLowerCase(), r = IA.get(s) ?? "image/png", n = await this.toBlob(r);
        return Ea(e, n);
      } else if (K.IS_FS_AVAILABLE) await this.toSharp().toFile(e);
      else throw new Error("Unable to save the image because filesystem is disabled in this environment.");
    }
    toSharp() {
      if (K.IS_WEB_ENV) throw new Error("toSharp() is only supported in server-side environments.");
      return Ma(this.data, { raw: { width: this.width, height: this.height, channels: this.channels } });
    }
  };
  var zA = Ee.read.bind(Ee);
  function pb(t6, e, s = 0, r = null) {
    let n = t6 / e, o = C0(n) * e;
    return r !== null && o > r && (o = Math.floor(n) * e), o < s && (o = Math.ceil(n) * e), o;
  }
  function ub([t6, e], s) {
    return [Math.max(Math.floor(t6 / s), 1) * s, Math.max(Math.floor(e / s), 1) * s];
  }
  function wu([t6, e, s, r]) {
    return [t6 - s / 2, e - r / 2, t6 + s / 2, e + r / 2];
  }
  function Rt(t6, e = 0.5, s = null, r = false) {
    let n = t6.logits, o = t6.pred_boxes, [i, a, l] = n.dims;
    if (s !== null && s.length !== i) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
    let c = [];
    for (let p = 0; p < i; ++p) {
      let u = s !== null ? s[p] : null, _ = { boxes: [], classes: [], scores: [] }, d = n[p], m = o[p];
      for (let f = 0; f < a; ++f) {
        let g = d[f], x = [], w;
        if (r) {
          w = g.sigmoid().data;
          for (let y = 0; y < w.length; ++y) w[y] > e && x.push(y);
        } else {
          let y = de(g.data)[1];
          if (y === l - 1 || (w = fe(g.data), w[y] < e)) continue;
          x.push(y);
        }
        for (let y of x) {
          let b = m[f].data;
          b = wu(b), u !== null && (b = b.map((v, k) => v * u[(k + 1) % 2])), _.boxes.push(b), _.classes.push(y), _.scores.push(w[y]);
        }
      }
      c.push(_);
    }
    return c;
  }
  function Sa(t6, e = null) {
    let s = t6.logits, r = s.dims[0];
    if (e !== null && e.length !== r) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
    let n = [];
    for (let o = 0; o < r; ++o) {
      let i = e !== null ? e[o] : null, a = s[o];
      i !== null && (a = rp(a, i, "bilinear", false));
      let [l, c] = i ?? a.dims.slice(-2), p = new E("int32", new Int32Array(l * c), [l, c]), u = a[0].data, _ = p.data;
      for (let f = 1; f < a.dims[0]; ++f) {
        let g = a[f].data;
        for (let x = 0; x < g.length; ++x) g[x] > u[x] && (u[x] = g[x], _[x] = f);
      }
      let d = new Array(a.dims[0]);
      for (let f = 0; f < _.length; ++f) {
        let g = _[f];
        d[g] = g;
      }
      let m = d.filter((f) => f !== void 0);
      n.push({ segmentation: p, labels: m });
    }
    return n;
  }
  function TA(t6, e, s, r) {
    let n = [], o = [], i = [];
    for (let a = 0; a < t6.dims[0]; ++a) {
      let l = t6[a], c = e[a], p = de(l.data)[1];
      if (p === r) continue;
      let _ = fe(l.data)[p];
      _ > s && (n.push(c), o.push(_), i.push(p));
    }
    return [n, o, i];
  }
  function CA(t6, e, s, r = 0.5, n = 0.8) {
    let o = [], i = 0, a = 0, l = e[s].data;
    for (let p = 0; p < t6.length; ++p) t6[p] === s && (o.push(p), ++i), l[p] >= r && ++a;
    let c = i > 0 && a > 0;
    return c && (c = i / a > n), [c, o];
  }
  function PA(t6, e, s, r, n, o = null, i = null) {
    let [a, l] = i ?? t6[0].dims, c = new E("int32", new Int32Array(a * l), [a, l]), p = [];
    if (i !== null) for (let f = 0; f < t6.length; ++f) t6[f] = rp(t6[f], i, "bilinear", false);
    let u = new Int32Array(t6[0].data.length), _ = new Float32Array(t6[0].data.length);
    for (let f = 0; f < t6.length; ++f) {
      let g = e[f], x = t6[f].data;
      for (let w = 0; w < x.length; ++w) x[w] *= g, x[w] > _[w] && (u[w] = f, _[w] = x[w]);
    }
    let d = 0, m = c.data;
    for (let f = 0; f < s.length; ++f) {
      let g = s[f], [x, w] = CA(u, t6, f, r, n);
      if (x) {
        ++d;
        for (let y of w) m[y] = d;
        p.push({ id: d, label_id: g, score: e[f] });
      }
    }
    return [c, p];
  }
  function Rs(t6, e, s = 28, r = 3136, n = 784 * 1280, o = 1) {
    if (t6 < s || e < s) {
      let l = Math.max(s / t6, s / e);
      t6 = Math.round(t6 * l), e = Math.round(e * l);
    }
    if (Math.max(t6, e) / Math.min(t6, e) > 200) throw new Error(`absolute aspect ratio must be smaller than 200, got ${Math.max(t6, e) / Math.min(t6, e)}`);
    let i = Math.round(t6 / s) * s, a = Math.round(e / s) * s;
    if (o * i * a > n) {
      let l = Math.sqrt(o * t6 * e / n);
      i = Math.max(s, Math.floor(t6 / l / s) * s), a = Math.max(s, Math.floor(e / l / s) * s);
    } else if (o * i * a < r) {
      let l = Math.sqrt(r / (o * t6 * e));
      i = Math.ceil(t6 * l / s) * s, a = Math.ceil(e * l / s) * s;
    }
    return [a, i];
  }
  function Oa(t6, e = 0.5, s = 0.5, r = 0.8, n = null, o = null) {
    n === null && (F.warn("`label_ids_to_fuse` unset. No instance will be fused."), n = /* @__PURE__ */ new Set());
    let i = t6.class_queries_logits ?? t6.logits, l = (t6.masks_queries_logits ?? t6.pred_masks).sigmoid(), [c, p, u] = i.dims;
    if (u -= 1, o !== null && o.length !== c) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
    let _ = [];
    for (let d = 0; d < c; ++d) {
      let m = o !== null ? o[d] : null, f = i[d], g = l[d], [x, w, y] = TA(f, g, e, u);
      if (y.length === 0) {
        let [k, S] = m ?? g.dims.slice(-2), I = new E("int32", new Int32Array(k * S).fill(-1), [k, S]);
        _.push({ segmentation: I, segments_info: [] });
        continue;
      }
      let [b, v] = PA(x, w, y, s, r, n, m);
      _.push({ segmentation: b, segments_info: v });
    }
    return _;
  }
  function Ia(t6, e = 0.5, s = null) {
    throw new Error("`post_process_instance_segmentation` is not yet implemented.");
  }
  var L = class extends xe {
    constructor(e) {
      super(), this.image_mean = e.image_mean ?? e.mean, this.image_std = e.image_std ?? e.std, this.resample = e.resample ?? 2, this.do_rescale = e.do_rescale ?? true, this.rescale_factor = e.rescale_factor ?? 1 / 255, this.do_normalize = e.do_normalize, this.do_thumbnail = e.do_thumbnail, this.size = e.size ?? e.image_size, this.do_resize = e.do_resize ?? this.size !== void 0, this.size_divisibility = e.size_divisibility ?? e.size_divisor, this.do_center_crop = e.do_center_crop, this.crop_size = e.crop_size, this.do_convert_rgb = e.do_convert_rgb ?? true, this.do_crop_margin = e.do_crop_margin, this.pad_size = e.pad_size, this.do_pad = e.do_pad, this.min_pixels = e.min_pixels, this.max_pixels = e.max_pixels, this.do_pad && !this.pad_size && !this.size_divisibility && this.size && this.size.width !== void 0 && this.size.height !== void 0 && (this.pad_size = this.size), this.do_flip_channel_order = e.do_flip_channel_order ?? false, this.config = e;
    }
    async thumbnail(e, s, r = 2) {
      let n = e.height, o = e.width, i = s.height, a = s.width, l = Math.min(n, i), c = Math.min(o, a);
      return l === n && c === o ? e : (n > o ? c = Math.floor(o * l / n) : o > n && (l = Math.floor(n * c / o)), await e.resize(c, l, { resample: r }));
    }
    async crop_margin(e, s = 200) {
      let r = e.clone().grayscale(), n = $r(r.data)[0], i = de(r.data)[0] - n;
      if (i === 0) return e;
      let a = s / 255, l = r.width, c = r.height, p = 0, u = 0, _ = r.data;
      for (let d = 0; d < r.height; ++d) {
        let m = d * r.width;
        for (let f = 0; f < r.width; ++f) (_[m + f] - n) / i < a && (l = Math.min(l, f), c = Math.min(c, d), p = Math.max(p, f), u = Math.max(u, d));
      }
      return e = await e.crop([l, c, p, u]), e;
    }
    pad_image(e, s, r, { mode: n = "constant", center: o = false, constant_values: i = 0 } = {}) {
      let [a, l, c] = s, p, u;
      if (typeof r == "number" ? (p = r, u = r) : r === "square" ? p = u = Math.max(a, l) : (p = r.width, u = r.height), p !== l || u !== a) {
        let _ = new Float32Array(p * u * c);
        if (Array.isArray(i)) for (let f = 0; f < _.length; ++f) _[f] = i[f % c];
        else i !== 0 && _.fill(i);
        let [d, m] = o ? [Math.floor((p - l) / 2), Math.floor((u - a) / 2)] : [0, 0];
        for (let f = 0; f < a; ++f) {
          let g = (f + m) * p, x = f * l;
          for (let w = 0; w < l; ++w) {
            let y = (g + w + d) * c, b = (x + w) * c;
            for (let v = 0; v < c; ++v) _[y + v] = e[b + v];
          }
        }
        if (n === "symmetric") {
          if (o) throw new Error("`center` padding is not supported when `mode` is set to `symmetric`.");
          let f = a - 1, g = l - 1;
          for (let x = 0; x < u; ++x) {
            let w = x * p, y = zs(x, f) * l;
            for (let b = 0; b < p; ++b) {
              if (x < a && b < l) continue;
              let v = (w + b) * c, k = (y + zs(b, g)) * c;
              for (let S = 0; S < c; ++S) _[v + S] = e[k + S];
            }
          }
        }
        e = _, s = [u, p, c];
      }
      return [e, s];
    }
    rescale(e) {
      for (let s = 0; s < e.length; ++s) e[s] = this.rescale_factor * e[s];
    }
    get_resize_output_image_size(e, s) {
      let [r, n] = e.size, o, i;
      if (this.do_thumbnail) {
        let { height: a, width: l } = s;
        o = Math.min(a, l);
      } else Number.isInteger(s) ? (o = s, i = this.config.max_size ?? o) : s !== void 0 && (o = s.shortest_edge, i = s.longest_edge);
      if (o !== void 0 || i !== void 0) {
        let a = o === void 0 ? 1 : Math.max(o / r, o / n), l = r * a, c = n * a, p = i === void 0 ? 1 : Math.min(i / l, i / c), u = Math.floor(Number((l * p).toFixed(2))), _ = Math.floor(Number((c * p).toFixed(2)));
        return this.size_divisibility !== void 0 && ([u, _] = ub([u, _], this.size_divisibility)), [u, _];
      } else if (s !== void 0 && s.width !== void 0 && s.height !== void 0) {
        let a = s.width, l = s.height;
        if (this.config.keep_aspect_ratio && this.config.ensure_multiple_of) {
          let c = l / n, p = a / r;
          Math.abs(1 - p) < Math.abs(1 - c) ? c = p : p = c, l = pb(c * n, this.config.ensure_multiple_of), a = pb(p * r, this.config.ensure_multiple_of);
        }
        return [a, l];
      } else {
        if (this.size_divisibility !== void 0) return ub([r, n], this.size_divisibility);
        throw new Error(`Could not resize image due to unsupported \`this.size\` option in config: ${JSON.stringify(s)}`);
      }
    }
    async resize(e) {
      let [s, r] = this.get_resize_output_image_size(e, this.size);
      return await e.resize(s, r, { resample: this.resample });
    }
    async preprocess(e, { do_normalize: s = null, do_pad: r = null, do_convert_rgb: n = null, do_convert_grayscale: o = null, do_flip_channel_order: i = null } = {}) {
      this.do_crop_margin && (e = await this.crop_margin(e));
      let [a, l] = e.size;
      if (n ?? this.do_convert_rgb ? e = e.rgb() : o && (e = e.grayscale()), this.do_resize && (e = await this.resize(e)), this.do_thumbnail && (e = await this.thumbnail(e, this.size, this.resample)), this.do_center_crop) {
        let d, m;
        Number.isInteger(this.crop_size) ? (d = this.crop_size, m = this.crop_size) : (d = this.crop_size.width, m = this.crop_size.height), e = await e.center_crop(d, m);
      }
      let c = [e.height, e.width], p = Float32Array.from(e.data), u = [e.height, e.width, e.channels];
      if (this.do_rescale && this.rescale(p), s ?? this.do_normalize) {
        let d = this.image_mean;
        Array.isArray(this.image_mean) || (d = new Array(e.channels).fill(d));
        let m = this.image_std;
        if (Array.isArray(this.image_std) || (m = new Array(e.channels).fill(m)), d.length !== e.channels || m.length !== e.channels) throw new Error(`When set to arrays, the length of \`image_mean\` (${d.length}) and \`image_std\` (${m.length}) must match the number of channels in the image (${e.channels}).`);
        for (let f = 0; f < p.length; f += e.channels) for (let g = 0; g < e.channels; ++g) p[f + g] = (p[f + g] - d[g]) / m[g];
      }
      if (r ?? this.do_pad) {
        if (this.pad_size) [p, u] = this.pad_image(p, [e.height, e.width, e.channels], this.pad_size);
        else if (this.size_divisibility) {
          let d = Math.ceil(u[1] / this.size_divisibility) * this.size_divisibility, m = Math.ceil(u[0] / this.size_divisibility) * this.size_divisibility;
          [p, u] = this.pad_image(p, u, { width: d, height: m });
        }
      }
      if (i ?? this.do_flip_channel_order) {
        if (u[2] !== 3) throw new Error("Flipping channel order is only supported for RGB images.");
        for (let d = 0; d < p.length; d += 3) {
          let m = p[d];
          p[d] = p[d + 2], p[d + 2] = m;
        }
      }
      let _ = new E("float32", p, u).permute(2, 0, 1);
      return { original_size: [l, a], reshaped_input_size: c, pixel_values: _ };
    }
    async _call(e, ...s) {
      Array.isArray(e) || (e = [e]);
      let r = await Promise.all(e.map((o) => this.preprocess(o)));
      return { pixel_values: qe(r.map((o) => o.pixel_values), 0), original_sizes: r.map((o) => o.original_size), reshaped_input_sizes: r.map((o) => o.reshaped_input_size) };
    }
    static async from_pretrained(e, s = {}) {
      let r = await Oe(e, kt, true, s);
      return new this(r);
    }
  };
  var Us = {};
  Os(Us, { BeitFeatureExtractor: () => yu, BitImageProcessor: () => bu, CHMv2ImageProcessor: () => vu, CLIPFeatureExtractor: () => Eu, CLIPImageProcessor: () => za, ChineseCLIPFeatureExtractor: () => ku, ConvNextFeatureExtractor: () => Au, ConvNextImageProcessor: () => Ta, DINOv3ViTImageProcessor: () => Ou, DPTFeatureExtractor: () => zu, DPTImageProcessor: () => Na, DeiTFeatureExtractor: () => Mu, DeiTImageProcessor: () => Ca, DetrFeatureExtractor: () => Su, DetrImageProcessor: () => Pa, DonutFeatureExtractor: () => Iu, DonutImageProcessor: () => Ds, EfficientNetImageProcessor: () => Tu, GLPNFeatureExtractor: () => Nu, Gemma3ImageProcessor: () => Cu, Gemma4ImageProcessor: () => Yr, Glm46VImageProcessor: () => Pu, GroundingDinoImageProcessor: () => Lu, Idefics3ImageProcessor: () => La, ImageFeatureExtractor: () => L, ImageProcessor: () => L, JinaCLIPImageProcessor: () => Fu, Lfm2VlImageProcessor: () => Ru, LlavaOnevisionImageProcessor: () => Du, Mask2FormerImageProcessor: () => ju, MaskFormerFeatureExtractor: () => qu, MaskFormerImageProcessor: () => qs, MobileNetV1FeatureExtractor: () => Bu, MobileNetV1ImageProcessor: () => $a, MobileNetV2FeatureExtractor: () => Uu, MobileNetV2ImageProcessor: () => Fa, MobileNetV3FeatureExtractor: () => Gu, MobileNetV3ImageProcessor: () => Ra, MobileNetV4FeatureExtractor: () => Wu, MobileNetV4ImageProcessor: () => Da, MobileViTFeatureExtractor: () => Vu, MobileViTImageProcessor: () => qa, NougatImageProcessor: () => Hu, OwlViTFeatureExtractor: () => Ku, OwlViTImageProcessor: () => js, Owlv2ImageProcessor: () => Xu, Phi3VImageProcessor: () => Ju, PixtralImageProcessor: () => Zu, PvtImageProcessor: () => e_, Qwen2VLImageProcessor: () => Jr, RTDetrImageProcessor: () => t_, Sam2ImageProcessor: () => Zr, Sam3ImageProcessor: () => Zr, SamImageProcessor: () => Zr, SapiensFeatureExtractor: () => s_, SapiensImageProcessor: () => ja, SegformerFeatureExtractor: () => r_, SegformerImageProcessor: () => Ba, SiglipImageProcessor: () => n_, SmolVLMImageProcessor: () => La, Swin2SRImageProcessor: () => o_, VLMImageProcessor: () => $u, ViTFeatureExtractor: () => i_, ViTImageProcessor: () => Ua, VitMatteImageProcessor: () => a_, VitPoseImageProcessor: () => l_, YolosFeatureExtractor: () => c_, YolosImageProcessor: () => Ga });
  var yu = class extends L {
  };
  var bu = class extends L {
  };
  var ku = class extends L {
  };
  var vu = class extends L {
  };
  var za = class extends L {
  };
  var Eu = class extends za {
  };
  var Ta = class extends L {
    constructor(e) {
      super(e), this.crop_pct = this.config.crop_pct ?? 224 / 256;
    }
    async resize(e) {
      let s = this.size?.shortest_edge;
      if (s === void 0) throw new Error("Size dictionary must contain 'shortest_edge' key.");
      if (s < 384) {
        let r = Math.floor(s / this.crop_pct), [n, o] = this.get_resize_output_image_size(e, { shortest_edge: r });
        e = await e.resize(n, o, { resample: this.resample }), e = await e.center_crop(s, s);
      } else e = await e.resize(s, s, { resample: this.resample });
      return e;
    }
  };
  var Au = class extends Ta {
  };
  var Ca = class extends L {
  };
  var Mu = class extends Ca {
  };
  var Pa = class extends L {
    async _call(e) {
      let s = await super._call(e), r = [s.pixel_values.dims[0], 64, 64], n = ke(r, 1n);
      return { ...s, pixel_mask: n };
    }
    post_process_object_detection(...e) {
      return Rt(...e);
    }
    post_process_panoptic_segmentation(...e) {
      return Oa(...e);
    }
    post_process_instance_segmentation(...e) {
      return Ia(...e);
    }
  };
  var Su = class extends Pa {
  };
  var Ou = class extends L {
  };
  var Ds = class extends L {
    pad_image(e, s, r, n = {}) {
      let [o, i, a] = s, l = this.image_mean;
      Array.isArray(this.image_mean) || (l = new Array(a).fill(l));
      let c = this.image_std;
      Array.isArray(c) || (c = new Array(a).fill(l));
      let p = l.map((u, _) => -u / c[_]);
      return super.pad_image(e, s, r, { center: true, constant_values: p, ...n });
    }
  };
  var Iu = class extends Ds {
  };
  var Na = class extends L {
  };
  var zu = class extends Na {
  };
  var Tu = class extends L {
    constructor(e) {
      super(e), this.include_top = this.config.include_top ?? true, this.include_top && (this.image_std = this.image_std.map((s) => s * s));
    }
  };
  var Cu = class extends L {
  };
  function NA(t6, e, s, r, n) {
    let o = r * s ** 2, i = Math.sqrt(o / (t6 * e)), a = n * s, l = Math.floor(i * t6 / a) * a, c = Math.floor(i * e / a) * a;
    if (l === 0 && c === 0) throw new Error(`Attempting to resize to a 0 x 0 image. Resized height should be divisible by \`pooling_kernel_size * patch_size\`=${a}.`);
    let p = Math.floor(r / n ** 2) * a;
    return l === 0 ? (l = a, c = Math.min(Math.floor(e / t6) * a, p)) : c === 0 && (c = a, l = Math.min(Math.floor(t6 / e) * a, p)), [l, c];
  }
  function LA(t6, e, s, r, n, o, i) {
    let a = Math.floor(e / n), l = Math.floor(s / n), c = a * l, p = n * n * r, u = new Float32Array(o * p), _ = 0;
    for (let f = 0; f < a; ++f) for (let g = 0; g < l; ++g) for (let x = 0; x < n; ++x) {
      let w = (f * n + x) * s * r + g * n * r;
      for (let y = 0; y < n; ++y) {
        let b = w + y * r;
        for (let v = 0; v < r; ++v) u[_++] = t6[b + v];
      }
    }
    let d = new BigInt64Array(o * 2).fill(-1n), m = 0;
    for (let f = 0; f < a; ++f) for (let g = 0; g < l; ++g) d[m++] = BigInt(g), d[m++] = BigInt(f);
    return { patches: new E("float32", u, [o, p]), positions: new E("int64", d, [o, 2]), num_soft_tokens: Math.floor(c / i ** 2) };
  }
  var Yr = class extends xe {
    constructor(e) {
      super(), this.config = e, this.patch_size = e.patch_size ?? 16, this.max_soft_tokens = e.max_soft_tokens ?? 280, this.pooling_kernel_size = e.pooling_kernel_size ?? 3, this.resample = e.resample ?? 3, this.rescale_factor = e.rescale_factor ?? 1 / 255, this.do_rescale = e.do_rescale ?? true, this.do_resize = e.do_resize ?? true, this.do_convert_rgb = e.do_convert_rgb ?? true;
    }
    async _call(e) {
      Array.isArray(e) || (e = [e]);
      let { patch_size: s, pooling_kernel_size: r } = this, n = this.max_soft_tokens * r ** 2, o = [], i = [], a = [];
      for (let l of e) {
        if (this.do_convert_rgb && (l = l.rgb()), this.do_resize) {
          let [d, m] = NA(l.height, l.width, s, n, r);
          (d !== l.height || m !== l.width) && (l = await l.resize(m, d, { resample: this.resample }));
        }
        let c = Float32Array.from(l.data);
        if (this.do_rescale) for (let d = 0; d < c.length; ++d) c[d] *= this.rescale_factor;
        let { patches: p, positions: u, num_soft_tokens: _ } = LA(c, l.height, l.width, l.channels, s, n, r);
        o.push(p), i.push(u), a.push(_);
      }
      return { pixel_values: qe(o, 0), image_position_ids: qe(i, 0), num_soft_tokens_per_image: a };
    }
  };
  var Jr = class extends L {
    constructor(e) {
      super(e), this.min_pixels = e.min_pixels ?? e.size?.shortest_edge, this.max_pixels = e.max_pixels ?? e.size?.longest_edge, this.patch_size = e.patch_size, this.merge_size = e.merge_size;
    }
    get_resize_output_image_size(e, s) {
      let r = this.patch_size * this.merge_size;
      return Rs(e.height, e.width, r, this.min_pixels, this.max_pixels);
    }
    async _call(e, ...s) {
      let { pixel_values: r, original_sizes: n, reshaped_input_sizes: o } = await super._call(e, ...s), i = r, { temporal_patch_size: a, merge_size: l, patch_size: c } = this.config;
      i.dims[0] === 1 && (i = ie(Array.from({ length: a }, () => i), 0));
      let p = i.dims[0] / a, u = i.dims[1], _ = Math.floor(i.dims[2] / c), d = Math.floor(i.dims[3] / c), m = i.view(p, a, u, Math.floor(_ / l), l, c, Math.floor(d / l), l, c).permute(0, 3, 6, 4, 7, 2, 1, 5, 8).view(p * _ * d, u * a * c * c), f = new E("int64", [p, _, d], [1, 3]);
      return { pixel_values: m, image_grid_thw: f, original_sizes: n, reshaped_input_sizes: o };
    }
  };
  var Pu = class extends Jr {
    get_resize_output_image_size(e, s) {
      let r = this.patch_size * this.merge_size, n = this.config.temporal_patch_size ?? 2;
      return Rs(e.height, e.width, r, this.min_pixels, this.max_pixels, n);
    }
  };
  var Nu = class extends L {
  };
  var Lu = class extends L {
    async _call(e) {
      let s = await super._call(e), r = s.pixel_values.dims, n = Me([r[0], r[2], r[3]]);
      return { ...s, pixel_mask: n };
    }
  };
  var La = class extends L {
    constructor(e) {
      super(e), this.do_image_splitting = e.do_image_splitting ?? true, this.max_image_size = e.max_image_size;
    }
    get_resize_for_vision_encoder(e, s) {
      let [r, n] = e.dims.slice(-2), o = n / r;
      return n >= r ? (n = Math.ceil(n / s) * s, r = Math.floor(n / o), r = Math.ceil(r / s) * s) : (r = Math.ceil(r / s) * s, n = Math.floor(r * o), n = Math.ceil(n / s) * s), { height: r, width: n };
    }
    async _call(e, { do_image_splitting: s = null, return_row_col_info: r = false } = {}) {
      let n;
      if (!Array.isArray(e)) n = [[e]];
      else {
        if (e.length === 0 || !e[0]) throw new Error("No images provided.");
        Array.isArray(e[0]) ? n = e : n = [e];
      }
      let o = [], i = [], a = [], l = [], c = [];
      for (let x of n) {
        let w = await Promise.all(x.map((v) => this.preprocess(v)));
        l.push(...w.map((v) => v.original_size)), c.push(...w.map((v) => v.reshaped_input_size)), w.forEach((v) => v.pixel_values.unsqueeze_(0));
        let { longest_edge: y } = this.max_image_size, b;
        if (s ?? this.do_image_splitting) {
          let v = new Array(w.length), k = new Array(w.length);
          b = await Promise.all(w.map(async (S, I) => {
            let $ = this.get_resize_for_vision_encoder(S.pixel_values, y), C = await je(S.pixel_values, { size: [$.height, $.width] }), { frames: q, num_splits_h: D, num_splits_w: B } = await this.split_image(C, this.max_image_size);
            return v[I] = D, k[I] = B, ie(q, 0);
          })), i.push(v), a.push(k);
        } else {
          let v = [y, y];
          b = await Promise.all(w.map((k) => je(k.pixel_values, { size: v }))), i.push(new Array(w.length).fill(0)), a.push(new Array(w.length).fill(0));
        }
        o.push(ie(b, 0));
      }
      let p = o.length, [u, _, d, m] = o[0].dims, f, g;
      if (p === 1) f = o[0].unsqueeze_(0), g = ke([p, u, d, m], true);
      else {
        let x = Math.max(...o.map((b) => b.dims.at(0)));
        g = ke([p, x, d, m], true);
        let w = g.data, y = x * d * m;
        for (let b = 0; b < p; ++b) {
          let v = o[b].dims[0];
          if (v < x) {
            o[b] = ie([o[b], ke([x - v, _, d, m], 0)], 0);
            let k = b * y + v * d * m, S = (b + 1) * y;
            w.fill(false, k, S);
          }
        }
        f = qe(o, 0);
      }
      return { pixel_values: f, pixel_attention_mask: g, original_sizes: l, reshaped_input_sizes: c, ...r ? { rows: i, cols: a } : {} };
    }
    async split_image(e, { longest_edge: s }) {
      let r = s, n = s, o = [], [i, a] = e.dims.slice(-2), l = 0, c = 0;
      if (i > r || a > n) {
        l = Math.ceil(i / r), c = Math.ceil(a / n);
        let p = Math.ceil(i / l), u = Math.ceil(a / c);
        for (let m = 0; m < l; ++m) for (let f = 0; f < c; ++f) {
          let g, x, w, y;
          m === l - 1 ? (x = i - p, y = i) : (x = m * p, y = (m + 1) * p), f === c - 1 ? (g = a - u, w = a) : (g = f * u, w = (f + 1) * u);
          let k = await wa(e, [x, g], [y, w], [2, 3]);
          o.push(k);
        }
        let _ = r, d = n;
        (i !== _ || a !== d) && (e = await je(e, { size: [_, d] }));
      }
      return o.push(e), { frames: o, num_splits_h: l, num_splits_w: c };
    }
  };
  var $u = class extends L {
    constructor(e) {
      super({ do_pad: true, pad_size: { width: e.image_size, height: e.image_size }, ...e }), this.constant_values = this.config.background_color.map((s) => s * this.rescale_factor);
    }
    pad_image(e, s, r, n) {
      return super.pad_image(e, s, r, { constant_values: this.constant_values, center: true, ...n });
    }
  };
  var Fu = class extends L {
    constructor(e) {
      let { resize_mode: s, fill_color: r, interpolation: n, size: o, ...i } = e, a = s === "squash" ? { width: o, height: o } : s === "shortest" ? { shortest_edge: o } : { longest_edge: o }, l = n === "bicubic" ? 3 : 2;
      super({ ...i, size: a, resample: l, do_center_crop: true, crop_size: o, do_normalize: true });
    }
  };
  function _b(t6, e) {
    return Math.round(t6 / e) * e;
  }
  function $A(t6, e, s, r, n) {
    let o = 1 / 0, i = [1, 1], a = s * r;
    for (let l of e) {
      let c = Math.abs(t6 - l[0] / l[1]);
      c < o ? (o = c, i = l) : c === o && a > 0.5 * n * n * l[0] * l[1] && (i = l);
    }
    return i;
  }
  function FA(t6, e) {
    let s = [], r = /* @__PURE__ */ new Set();
    for (let n = t6; n <= e; ++n) for (let o = 1; o <= n; ++o) for (let i = 1; i <= n; ++i) {
      let a = o * i;
      if (a >= t6 && a <= e) {
        let l = o << 16 | i;
        r.has(l) || (r.add(l), s.push([o, i]));
      }
    }
    return s.sort((n, o) => n[0] * n[1] - o[0] * o[1]);
  }
  function RA(t6, e) {
    let [s, r, n, o] = t6.dims, i = Math.floor(n / e), a = Math.floor(o / e), l = e * e * r, c = t6.data, p = new Float32Array(s * i * a * l), u = n * o;
    for (let _ = 0; _ < s; ++_) {
      let d = _ * r * u, m = _ * i * a * l;
      for (let f = 0; f < i; ++f) for (let g = 0; g < a; ++g) {
        let x = m + (f * a + g) * l;
        for (let w = 0; w < e; ++w) {
          let y = (f * e + w) * o + g * e;
          for (let b = 0; b < e; ++b) {
            let v = y + b;
            for (let k = 0; k < r; ++k) p[x++] = c[d + k * u + v];
          }
        }
      }
    }
    return new E("float32", p, [s, i * a, l]);
  }
  function DA(t6, e) {
    let [, s, r] = t6.dims, n = new BigInt64Array(e);
    n.fill(1n, 0, s);
    let o = t6;
    if (s < e) {
      let i = new Float32Array(e * r);
      i.set(t6.data), o = new E("float32", i, [1, e, r]);
    }
    return { padded: o, mask: new E("int64", n, [e]) };
  }
  var Ru = class extends L {
    constructor(e) {
      super(e), this.downsample_factor = e.downsample_factor ?? 2, this.do_image_splitting = e.do_image_splitting ?? true, this.min_tiles = e.min_tiles ?? 2, this.max_tiles = e.max_tiles ?? 10, this.use_thumbnail = e.use_thumbnail ?? true, this.min_image_tokens = e.min_image_tokens ?? 64, this.max_image_tokens = e.max_image_tokens ?? 256, this.encoder_patch_size = e.encoder_patch_size ?? e.patch_size ?? 16, this.tile_size = e.tile_size ?? 512, this.max_pixels_tolerance = e.max_pixels_tolerance ?? 2, this.return_row_col_info = e.return_row_col_info ?? false;
      let s = this.max_image_tokens * this.downsample_factor ** 2, r = this.do_image_splitting ? (this.tile_size / this.encoder_patch_size) ** 2 : 0;
      this.max_num_patches = Math.max(s, r);
    }
    _is_image_too_large(e, s) {
      let r = this.encoder_patch_size * this.downsample_factor, n = Math.max(this.encoder_patch_size, _b(e, r)), o = Math.max(this.encoder_patch_size, _b(s, r));
      return n * o > this.max_image_tokens * (this.encoder_patch_size * this.downsample_factor) ** 2 * this.max_pixels_tolerance;
    }
    _get_grid_layout(e, s) {
      let r = FA(this.min_tiles, this.max_tiles), [n, o] = $A(s / e, r, s, e, this.tile_size);
      return { grid_width: n, grid_height: o, target_width: this.tile_size * n, target_height: this.tile_size * o };
    }
    async _call(e, { return_row_col_info: s = null } = {}) {
      let r;
      Array.isArray(e) ? Array.isArray(e[0]) ? r = e : r = [e] : r = [[e]];
      let n = [], o = [], i = [], a = [], l = [], c = [];
      for (let u of r) {
        let _ = await Promise.all(u.map((d) => this.preprocess(d, { do_pad: false })));
        for (let { pixel_values: d } of _) {
          let [, m, f] = d.dims, g = d.unsqueeze_(0), x = this.encoder_patch_size * this.downsample_factor, w = x ** 2, [y, b] = Rs(Math.max(x, m), Math.max(x, f), x, this.min_image_tokens * w, this.max_image_tokens * w).map((C) => Math.max(x, C)), v, k = 1, S = 1, I = this._is_image_too_large(m, f), $ = this.do_image_splitting && !(this.min_tiles === 1 && this.max_tiles === 1);
          if (I && $) {
            let { grid_width: C, grid_height: q, target_width: D, target_height: B } = this._get_grid_layout(m, f);
            k = q, S = C;
            let H = await je(g, { size: [B, D] });
            v = [];
            for (let V = 0; V < q; ++V) for (let Z = 0; Z < C; ++Z) {
              let R = V * this.tile_size, A = Z * this.tile_size;
              v.push(H.slice(null, null, [R, R + this.tile_size], [A, A + this.tile_size]));
            }
            this.use_thumbnail && C * q !== 1 && v.push(await je(g, { size: [b, y] }));
          } else v = [await je(g, { size: [b, y] })];
          for (let C of v) {
            let [, , q, D] = C.dims, B = RA(C, this.encoder_patch_size), { padded: H, mask: V } = DA(B, this.max_num_patches);
            n.push(H), o.push(V), i.push([Math.floor(q / this.encoder_patch_size), Math.floor(D / this.encoder_patch_size)]);
          }
          a.push(k), l.push(S), c.push([b, y]);
        }
      }
      let p = { pixel_values: ie(n, 0), pixel_attention_mask: qe(o, 0), spatial_shapes: new E("int64", BigInt64Array.from(i.flat(), BigInt), [i.length, 2]) };
      return (s ?? this.return_row_col_info) && (p.image_rows = a, p.image_cols = l, p.image_sizes = c), p;
    }
  };
  var Du = class extends L {
  };
  var qs = class extends L {
    post_process_panoptic_segmentation(...e) {
      return Oa(...e);
    }
    post_process_instance_segmentation(...e) {
      return Ia(...e);
    }
  };
  var qu = class extends qs {
  };
  var ju = class extends qs {
  };
  var $a = class extends L {
  };
  var Bu = class extends $a {
  };
  var Fa = class extends L {
  };
  var Uu = class extends Fa {
  };
  var Ra = class extends L {
  };
  var Gu = class extends Ra {
  };
  var Da = class extends L {
  };
  var Wu = class extends Da {
  };
  var qa = class extends L {
  };
  var Vu = class extends qa {
  };
  var Hu = class extends Ds {
  };
  var js = class extends L {
    post_process_object_detection(...e) {
      return Rt(...e);
    }
  };
  var Ku = class extends js {
  };
  var Xu = class extends js {
  };
  var Xe = 336;
  var qA = [2, 3];
  var { ceil: Qu, floor: Bs, sqrt: Yu } = Math;
  var Ju = class extends L {
    constructor(e) {
      super({ ...e, do_normalize: true, do_pad: true, pad_size: "custom", do_convert_rgb: true, do_resize: true }), this._num_crops = e.num_crops;
    }
    calc_num_image_tokens_from_image_size(e, s) {
      let { num_img_tokens: r } = this.config;
      return Bs((Bs(s / Xe) * Bs(e / Xe) + 1) * r + 1 + (Bs(s / Xe) + 1) * Yu(r));
    }
    get_resize_output_image_size(e, s) {
      let r = this._num_crops, [n, o] = e.size, i = n / o, a = 1;
      for (; a * Math.ceil(a / i) <= r; ) a += 1;
      a -= 1;
      let l = Math.floor(a * 336), c = Math.floor(l / i);
      return [l, c];
    }
    pad_image(e, s, r, n = {}) {
      let [o, i] = s, a = Xe * Qu(o / Xe), l = Xe * Qu(i / Xe), c = [1, 1, 1].map((p, u) => (p - this.image_mean[u]) / this.image_std[u]);
      return super.pad_image(e, s, { width: l, height: a }, { center: true, constant_values: c, ...n });
    }
    async _call(e, { num_crops: s = null } = {}) {
      if (this._num_crops = s ?? (s = this.config.num_crops), s < 4 || Yu(s) % 1 !== 0) throw new Error("num_crops must be a square number >= 4");
      Array.isArray(e) || (e = [e]);
      let r = e.length, n = await Promise.all(e.map((_) => this.preprocess(_))), o = n.map((_) => _.original_size), i = n.map((_) => _.reshaped_input_size), a = [];
      for (let { pixel_values: _ } of n) {
        _.unsqueeze_(0);
        let [d, m] = _.dims.slice(-2), f = await je(_, { size: [Xe, Xe], mode: "bicubic" });
        if (s > 0) {
          let g = [], x = Yu(s), w = Bs(m / x), y = Bs(d / x);
          for (let v = 0; v < x; ++v) for (let k = 0; k < x; ++k) {
            let S, I, $, C;
            v === x - 1 ? (I = d - y, C = d) : (I = v * y, C = (v + 1) * y), k === x - 1 ? (S = m - w, $ = m) : (S = k * w, $ = (k + 1) * w);
            let B = await wa(_, [I, S], [C, $], qA);
            g.push(B);
          }
          let b = await je(ie(g, 0), { size: [Xe, Xe], mode: "bicubic" });
          a.push(ie([f, b], 0));
        } else a.push(f);
      }
      let l = qe(a, 0), c = i.map((_) => _.map((d) => Xe * Qu(d / Xe))), p = new E("int64", c.flat(), [r, 2]), u = c.map(([_, d]) => this.calc_num_image_tokens_from_image_size(d, _));
      return { pixel_values: l, original_sizes: o, reshaped_input_sizes: i, image_sizes: p, num_img_tokens: u };
    }
  };
  var Zu = class extends L {
    get_resize_output_image_size(e, s) {
      let { longest_edge: r } = s;
      if (r === void 0) throw new Error("size must contain 'longest_edge'");
      let [n, o] = e.size, i = Math.max(n, o) / r, a = n, l = o;
      i > 1 && (a = Math.floor(n / i), l = Math.floor(o / i));
      let { patch_size: c, spatial_merge_size: p } = this.config;
      if (!p) throw new Error("config must contain 'spatial_merge_size'");
      let u = c * p, _ = Math.floor((a - 1) / u) + 1, d = Math.floor((l - 1) / u) + 1;
      return [_ * u, d * u];
    }
  };
  var e_ = class extends L {
  };
  var t_ = class extends L {
    post_process_object_detection(...e) {
      return Rt(...e);
    }
  };
  var Zr = class extends L {
    reshape_input_points(e, s, r, n = false) {
      e = structuredClone(e);
      let o = Bc(e);
      if (o.length === 3) n || (o = [1, ...o]), e = [e];
      else if (o.length !== 4) throw Error("The input_points must be a 4D tensor of shape `batch_size`, `point_batch_size`, `nb_points_per_image`, `2`.");
      for (let i = 0; i < e.length; ++i) {
        let [a, l] = s[i], [c, p] = r[i], u = [p / l, c / a];
        for (let _ = 0; _ < e[i].length; ++_) for (let d = 0; d < e[i][_].length; ++d) for (let m = 0; m < e[i][_][d].length; ++m) e[i][_][d][m] *= u[m % 2];
      }
      return new E("float32", Float32Array.from(e.flat(1 / 0)), o);
    }
    add_input_labels(e, s) {
      let r = Bc(e);
      if (r.length === 2) r = [1, ...r], e = [e];
      else if (r.length !== 3) throw Error("The input_points must be a 4D tensor of shape `batch_size`, `point_batch_size`, `nb_points_per_image`, `2`.");
      if (r.some((n, o) => n !== s.dims[o])) throw Error(`The first ${r.length} dimensions of 'input_points' and 'input_labels' must be the same.`);
      return new E("int64", e.flat(1 / 0).map(BigInt), r);
    }
    async _call(e, { input_points: s = null, input_labels: r = null, input_boxes: n = null } = {}) {
      let o = await super._call(e);
      if (s && (o.input_points = this.reshape_input_points(s, o.original_sizes, o.reshaped_input_sizes)), r) {
        if (!o.input_points) throw Error("`input_points` must be provided if `input_labels` are provided.");
        o.input_labels = this.add_input_labels(r, o.input_points);
      }
      return n && (o.input_boxes = this.reshape_input_points(n, o.original_sizes, o.reshaped_input_sizes, true)), o;
    }
    async post_process_masks(e, s, r, { mask_threshold: n = 0, binarize: o = true, pad_size: i = null } = {}) {
      let a = [];
      i = i ?? this.pad_size ?? this.size;
      let l = [i.height, i.width];
      for (let c = 0; c < s.length; ++c) {
        let p = s[c], u = r[c], _ = await je(e[c], { mode: "bilinear", size: l });
        if (_ = _.slice(null, null, [0, u[0]], [0, u[1]]), _ = await je(_, { mode: "bilinear", size: p }), o) {
          let d = _.data, m = new Uint8Array(d.length);
          for (let f = 0; f < d.length; ++f) d[f] > n && (m[f] = 1);
          _ = new E("bool", m, _.dims);
        }
        a.push(_);
      }
      return a;
    }
    generate_crop_boxes(e, s, { crop_n_layers: r = 0, overlap_ratio: n = 512 / 1500, points_per_crop: o = 32, crop_n_points_downscale_factor: i = 1 } = {}) {
    }
  };
  var ja = class extends L {
    post_process_semantic_segmentation(...e) {
      return Sa(...e);
    }
  };
  var s_ = class extends ja {
  };
  var Ba = class extends L {
    post_process_semantic_segmentation(...e) {
      return Sa(...e);
    }
  };
  var r_ = class extends Ba {
  };
  var n_ = class extends L {
  };
  var o_ = class extends L {
    pad_image(e, s, r, n = {}) {
      let [o, i, a] = s;
      return super.pad_image(e, s, { width: i + (r - i % r) % r, height: o + (r - o % r) % r }, { mode: "symmetric", center: false, constant_values: -1, ...n });
    }
  };
  var Ua = class extends L {
  };
  var i_ = class extends Ua {
  };
  var a_ = class extends L {
    async _call(e, s) {
      Array.isArray(e) || (e = [e]), Array.isArray(s) || (s = [s]);
      let r = await Promise.all(e.map((i) => this.preprocess(i))), n = await Promise.all(s.map((i) => this.preprocess(i, { do_normalize: false, do_convert_rgb: false, do_convert_grayscale: true })));
      return { pixel_values: qe(r.map((i, a) => ie([i.pixel_values, n[a].pixel_values], 0)), 0), original_sizes: r.map((i) => i.original_size), reshaped_input_sizes: r.map((i) => i.reshaped_input_size) };
    }
  };
  var l_ = class extends L {
    post_process_pose_estimation(e, s, { threshold: r = null } = {}) {
      let n = e.tolist(), [o, i, a, l] = e.dims, c = [];
      for (let p = 0; p < o; ++p) {
        let u = n[p], _ = s[p], d = [];
        for (let m = 0; m < _.length; ++m) {
          let f = _[m], g = [], x = [], w = [], y = f.at(-2) / l, b = f.at(-1) / a;
          for (let v = 0; v < u.length; ++v) {
            let [k, S] = [0, 0], I = 0, $ = -1 / 0, C = u[v];
            for (let D = 0; D < C.length; ++D) {
              let B = C[D];
              for (let H = 0; H < B.length; ++H) {
                let V = B[H];
                I += V, $ = Math.max($, V), k += (H + 0.5) * V, S += D * V;
              }
            }
            if (r != null && $ < r) continue;
            let q = [y * k / I, b * S / I];
            g.push(q), w.push(v), x.push($);
          }
          d.push({ bbox: f, scores: x, labels: w, keypoints: g });
        }
        c.push(d);
      }
      return c;
    }
  };
  var Ga = class extends L {
    post_process_object_detection(...e) {
      return Rt(...e);
    }
  };
  var c_ = class extends Ga {
  };
  var pe = class {
    static async from_pretrained(e, s = {}) {
      let r = await Oe(e, kt, true, s), n = r.image_processor_type ?? r.feature_extractor_type, o = Us[n?.replace(/Fast$/, "")];
      return o || (n !== void 0 && F.warn(`Image processor type '${n}' not found, assuming base ImageProcessor. Please report this at ${$t}.`), o = L), new o(r);
    }
  };
  var _a8;
  var p_ = (_a8 = class extends U {
    constructor(e, s, r) {
      super(e, s, r);
      let { tasks_answer_post_processing_type: n, task_prompts_without_inputs: o, task_prompts_with_input: i } = this.image_processor.config;
      this.tasks_answer_post_processing_type = new Map(Object.entries(n ?? {})), this.task_prompts_without_inputs = new Map(Object.entries(o ?? {})), this.task_prompts_with_input = new Map(Object.entries(i ?? {})), this.regexes = { quad_boxes: /(.+?)<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>/gm, bboxes: /([^<]+)?<loc_(\d+)><loc_(\d+)><loc_(\d+)><loc_(\d+)>/gm }, this.size_per_bin = 1e3;
    }
    construct_prompts(e) {
      typeof e == "string" && (e = [e]);
      let s = [];
      for (let r of e) if (this.task_prompts_without_inputs.has(r)) s.push(this.task_prompts_without_inputs.get(r));
      else {
        for (let [n, o] of this.task_prompts_with_input) if (r.includes(n)) {
          s.push(o.replaceAll("{input}", r).replaceAll(n, ""));
          break;
        }
        s.length !== e.length && s.push(r);
      }
      return s;
    }
    post_process_generation(e, s, r) {
      let n = this.tasks_answer_post_processing_type.get(s) ?? "pure_text";
      e = e.replaceAll("<s>", "").replaceAll("</s>", "");
      let o;
      switch (n) {
        case "pure_text":
          o = e;
          break;
        case "description_with_bboxes":
        case "bboxes":
        case "phrase_grounding":
        case "ocr":
          let i = n === "ocr" ? "quad_boxes" : "bboxes", a = e.matchAll(this.regexes[i]), l = [], c = [];
          for (let [p, u, ..._] of a) l.push(u ? u.trim() : l.at(-1) ?? ""), c.push(_.map((d, m) => (Number(d) + 0.5) / this.size_per_bin * r[m % 2]));
          o = { labels: l, [i]: c };
          break;
        default:
          throw new Error(`Task "${s}" (of type "${n}") not yet implemented.`);
      }
      return { [s]: o };
    }
    async _call(e, s = null, r = {}) {
      if (!e && !s) throw new Error("Either text or images must be provided");
      let n = await this.image_processor(e, r), o = s ? this.tokenizer(this.construct_prompts(s), r) : {};
      return { ...n, ...o };
    }
  }, __publicField(_a8, "tokenizer_class", W), __publicField(_a8, "image_processor_class", pe), _a8);
  var _a9;
  var u_ = (_a9 = class extends U {
    constructor(e, s, r) {
      super(e, s, r), this.image_seq_length = this.config.image_seq_length;
      let { boi_token: n, image_token: o, eoi_token: i } = this.tokenizer.config;
      this.boi_token = n, this.image_token = o, this.eoi_token = i;
      let a = o.repeat(this.image_seq_length);
      this.full_image_sequence = `

${n}${a}${i}

`;
    }
    async _call(e, s = null, r = {}) {
      typeof e == "string" && (e = [e]);
      let n;
      return s && (n = await this.image_processor(s, r), e = e.map((i) => i.replaceAll(this.boi_token, this.full_image_sequence))), { ...this.tokenizer(e, r), ...n };
    }
  }, __publicField(_a9, "tokenizer_class", W), __publicField(_a9, "image_processor_class", pe), __publicField(_a9, "uses_processor_config", true), __publicField(_a9, "uses_chat_template_file", true), _a9);
  var _a10;
  var __ = (_a10 = class extends U {
    constructor(e, s, r) {
      super(e, s, r), this.audio_seq_length = this.config.audio_seq_length, this.image_seq_length = this.config.image_seq_length;
      let { audio_token_id: n, boa_token: o, audio_token: i, eoa_token: a, image_token_id: l, boi_token: c, image_token: p, eoi_token: u } = this.tokenizer.config;
      this.audio_token_id = n, this.boa_token = o, this.audio_token = i;
      let _ = i.repeat(this.audio_seq_length);
      this.full_audio_sequence = `

${o}${_}${a}

`, this.image_token_id = l, this.boi_token = c, this.image_token = p;
      let d = p.repeat(this.image_seq_length);
      this.full_image_sequence = `

${c}${d}${u}

`;
    }
    async _call(e, s = null, r = null, n = {}) {
      typeof e == "string" && (e = [e]);
      let o;
      r && (o = await this.feature_extractor(r, n), e = e.map((l) => l.replaceAll(this.audio_token, this.full_audio_sequence)));
      let i;
      return s && (i = await this.image_processor(s, n), e = e.map((l) => l.replaceAll(this.image_token, this.full_image_sequence))), { ...this.tokenizer(e, n), ...i, ...o };
    }
  }, __publicField(_a10, "image_processor_class", pe), __publicField(_a10, "feature_extractor_class", ge), __publicField(_a10, "tokenizer_class", W), __publicField(_a10, "uses_processor_config", true), __publicField(_a10, "uses_chat_template_file", true), _a10);
  var _a11;
  var d_ = (_a11 = class extends U {
    constructor(e, s, r) {
      super(e, s, r), this.audio_ms_per_token = this.config.audio_ms_per_token ?? 40, this.audio_seq_length = this.config.audio_seq_length ?? 750, this.image_seq_length = this.config.image_seq_length ?? 280;
      let { audio_token: n, boa_token: o, eoa_token: i, image_token: a, boi_token: l, eoi_token: c } = this.tokenizer.config;
      this.audio_token = n, this.boa_token = o, this.eoa_token = i, this.image_token = a, this.boi_token = l, this.eoi_token = c;
    }
    static async from_pretrained(e, s = {}) {
      let [r, n, o] = await Promise.all([Oe(e, ka, true, s), W.from_pretrained(e, s), Lr(e, va, false, s)]), i = { tokenizer: n };
      return r.image_processor && (i.image_processor = new Yr(r.image_processor)), r.feature_extractor && (i.feature_extractor = new Kr(r.feature_extractor)), new this(r, i, o);
    }
    _compute_audio_num_tokens(e, s) {
      let r = Math.round(s * 20 / 1e3), n = Math.round(s * 10 / 1e3), o = Math.floor(r / 2), i = Math.floor((e + o - r - 1) / n) + 1;
      if (i <= 0) return 0;
      for (let a = 0; a < 2; ++a) i = Math.floor((i - 1) / 2) + 1;
      return Math.min(i, this.audio_seq_length);
    }
    async _call(e, s = null, r = null, n = {}) {
      typeof e == "string" && (e = [e]);
      let o;
      if (s) {
        o = await this.image_processor(s, n);
        let a = o.num_soft_tokens_per_image, l = 0;
        e = e.map((c) => c.replaceAll(this.image_token, () => `

${this.boi_token}${this.image_token.repeat(a[l++])}${this.eoi_token}

`));
      }
      let i;
      if (r) {
        let a = Array.isArray(r) ? r : [r];
        i = await this.feature_extractor(a[0], n);
        let l = this.feature_extractor.config.sampling_rate ?? 16e3, c = 0;
        e = e.map((p) => p.replaceAll(this.audio_token, () => `

${this.boa_token}${this.audio_token.repeat(this._compute_audio_num_tokens(a[c++].length, l))}${this.eoa_token}

`));
      }
      return { ...this.tokenizer(e, n), ...o, ...i };
    }
  }, __publicField(_a11, "uses_processor_config", true), __publicField(_a11, "uses_chat_template_file", true), _a11);
  var _a12;
  var ls = (_a12 = class extends U {
    async _call(e, s = null, ...r) {
      Array.isArray(e) || (e = [e]);
      let n, o;
      if (s && (n = await this.image_processor(s), o = n.image_grid_thw), o) {
        let a = this.image_processor.config.merge_size ** 2, l = 0, c = this.constructor.image_token, p = o.tolist();
        e = e.map((u) => {
          for (; u.includes(c); ) {
            let _ = Number(p[l++].reduce((d, m) => d * m, 1n));
            u = u.replace(c, "<|placeholder|>".repeat(Math.floor(_ / a)));
          }
          return u.replaceAll("<|placeholder|>", c);
        });
      }
      return { ...this.tokenizer(e), ...n };
    }
  }, __publicField(_a12, "image_processor_class", pe), __publicField(_a12, "tokenizer_class", W), __publicField(_a12, "image_token", "<|image_pad|>"), _a12);
  var _a13;
  var m_ = (_a13 = class extends ls {
  }, __publicField(_a13, "image_token", "<|image|>"), _a13);
  var _a14;
  var f_ = (_a14 = class extends U {
    _get_num_audio_features(e) {
      let { hop_length: s } = this.feature_extractor.config.melspec_kwargs, { projector_window_size: r, projector_downsample_rate: n } = this.feature_extractor.config, o = Math.floor(r / n), i = Math.floor(e / s) + 1, a = Math.floor(i / 2);
      return Math.ceil(a / r) * o;
    }
    async _call(e, s = null, r = {}) {
      if (Array.isArray(e)) throw new Error("Batched inputs are not supported yet.");
      let n = {};
      if (s) {
        let { input_features: i } = await this.feature_extractor(s);
        n.input_features = i;
        let a = this._get_num_audio_features(s.length), l = new Uint8Array(a).fill(1);
        n.input_features_mask = new E("bool", l, [1, a]);
        let c = this.config.audio_token ?? "<|audio|>";
        if (!e.includes(c)) throw new Error(`The input text does not contain the audio token ${c}.`);
        e = e.replaceAll(c, c.repeat(a));
      }
      return { ...this.tokenizer(e, { add_special_tokens: false, ...r }), ...n };
    }
  }, __publicField(_a14, "tokenizer_class", W), __publicField(_a14, "feature_extractor_class", ge), __publicField(_a14, "uses_processor_config", true), _a14);
  function jA(t6, e) {
    let r = t6.dims.at(-1) - 1, n = t6.tolist();
    n.fill(false, 0, 1), n.fill(false, r);
    let o = e.tolist();
    return n.map((i, a) => i ? a : null).filter((i) => i !== null).map((i) => o[i]);
  }
  var _a15;
  var h_ = (_a15 = class extends U {
    async _call(e, s, r = {}) {
      let n = e ? await this.image_processor(e, r) : {};
      return { ...s ? this.tokenizer(s, r) : {}, ...n };
    }
    post_process_grounded_object_detection(e, s, { box_threshold: r = 0.25, text_threshold: n = 0.25, target_sizes: o = null } = {}) {
      let { logits: i, pred_boxes: a } = e, l = i.dims[0];
      if (o !== null && o.length !== l) throw Error("Make sure that you pass in as many target sizes as the batch dimension of the logits");
      let c = i.dims.at(1), p = i.sigmoid(), u = p.max(-1).tolist(), _ = a.tolist().map((m) => m.map((f) => wu(f))), d = [];
      for (let m = 0; m < l; ++m) {
        let f = o !== null ? o[m] : null;
        f !== null && (_[m] = _[m].map((b) => b.map((v, k) => v * f[(k + 1) % 2])));
        let g = u[m], x = [], w = [], y = [];
        for (let b = 0; b < c; ++b) {
          let v = g[b];
          if (v <= r) continue;
          let k = _[m][b], S = p[m][b];
          x.push(v), y.push(k);
          let I = jA(S.gt(n), s[m]);
          w.push(I);
        }
        d.push({ scores: x, boxes: y, labels: this.batch_decode(w) });
      }
      return d;
    }
  }, __publicField(_a15, "tokenizer_class", W), __publicField(_a15, "image_processor_class", pe), _a15);
  function BA(t6, e, s, r, n, o) {
    let i = "";
    for (let a = 0; a < e; ++a) {
      for (let l = 0; l < s; ++l) i += r + `<row_${a + 1}_col_${l + 1}>` + n.repeat(t6);
      i += `
`;
    }
    return i += `
${r}${o}` + n.repeat(t6) + `${r}`, i;
  }
  function UA(t6, e, s, r) {
    return `${e}${r}` + s.repeat(t6) + `${e}`;
  }
  function GA(t6, e, s, r, n, o) {
    return t6 === 0 && e === 0 ? UA(s, r, n, o) : BA(s, t6, e, r, n, o);
  }
  var _a16;
  var Wa = (_a16 = class extends U {
    constructor() {
      super(...arguments);
      __publicField(this, "fake_image_token", "<fake_token_around_image>");
      __publicField(this, "image_token", "<image>");
      __publicField(this, "global_img_token", "<global-img>");
    }
    async _call(e, s = null, r = {}) {
      r.return_row_col_info ?? (r.return_row_col_info = true);
      let n;
      s && (n = await this.image_processor(s, r)), Array.isArray(e) || (e = [e]);
      let o = n.rows ?? [new Array(e.length).fill(0)], i = n.cols ?? [new Array(e.length).fill(0)], a = this.config.image_seq_len, l = [], c = [];
      for (let u = 0; u < e.length; ++u) {
        let _ = e[u], d = o[u], m = i[u];
        l.push(jy(_, this.image_token));
        let f = d.map((w, y) => GA(w, m[y], a, this.fake_image_token, this.image_token, this.global_img_token)), g = _.split(this.image_token);
        if (g.length === 0) throw new Error("The image token should be present in the text.");
        let x = g[0];
        for (let w = 0; w < f.length; ++w) x += f[w] + g[w + 1];
        c.push(x);
      }
      return { ...this.tokenizer(c), ...n };
    }
  }, __publicField(_a16, "image_processor_class", pe), __publicField(_a16, "tokenizer_class", W), __publicField(_a16, "uses_processor_config", true), _a16);
  var _a17;
  var g_ = (_a17 = class extends U {
    constructor(e, s, r) {
      super(e, s, r), this.image_tag = this.config.image_tag, this.image_start_tag = this.config.image_start_tag, this.image_end_tag = this.config.image_end_tag, this.num_image_tokens = this.config.num_image_tokens;
    }
    async _call(e, { images: s = null, chat_template: r = "default" } = {}) {
      s ? Array.isArray(s) || (s = [s]) : s = await Promise.all(e.filter((g) => g.images).flatMap((g) => g.images).map((g) => Ee.read(g)));
      let n = this.tokenizer, o = n.apply_chat_template(e, { tokenize: false, add_generation_prompt: true, chat_template: r }), i = (g) => n.encode(g, { add_special_tokens: false }), a = o.split(this.image_tag), l = a.length - 1;
      if (s.length !== l) throw new Error(`Number of images provided (${s.length}) does not match number of "${this.image_tag}" image tags (${l})`);
      let [c, p, u] = n.convert_tokens_to_ids([this.image_tag, this.image_start_tag, this.image_end_tag]), _ = i(a[0]), d = new Array(_.length).fill(false);
      for (let g = 1; g < a.length; ++g) {
        let x = new Array(this.num_image_tokens).fill(c), w = i(a[g]);
        _ = Fe(_, [p], x, [u], w);
        let y = new Array(this.num_image_tokens).fill(true);
        d = Fe(d, [false], y, [false], new Array(w.length).fill(false));
      }
      let m = [1, _.length], f = { input_ids: new E("int64", _, m), attention_mask: new E("int64", new Array(_.length).fill(1), m), images_seq_mask: new E("bool", d, m), images_emb_mask: new E("bool", new Array(l * this.num_image_tokens).fill(true), [1, l, this.num_image_tokens]) };
      if (s && s.length > 0) {
        let g = await this.image_processor(s);
        return g.pixel_values.unsqueeze_(0), { ...f, ...g };
      }
      return f;
    }
  }, __publicField(_a17, "image_processor_class", pe), __publicField(_a17, "tokenizer_class", W), __publicField(_a17, "uses_processor_config", true), _a17);
  var _a18;
  var x_ = (_a18 = class extends U {
    async _call(e = null, s = null, r = {}) {
      if (!e && !s) throw new Error("Either text or images must be provided");
      let n = e ? this.tokenizer(e, r) : {}, o = s ? await this.image_processor(s, r) : {};
      return { ...n, ...o };
    }
  }, __publicField(_a18, "tokenizer_class", W), __publicField(_a18, "image_processor_class", pe), _a18);
  var _a19;
  var w_ = (_a19 = class extends U {
    async _call(e, s = null, r = {}) {
      let { image_rows: n, image_cols: o, image_sizes: i, ...a } = await this.image_processor(e, { ...r, return_row_col_info: true });
      if (s) {
        let l = this.config.image_token ?? "<image>", { tile_size: c = 512, downsample_factor: p = 2, encoder_patch_size: u = 16, use_thumbnail: _ = true } = this.image_processor.config, d = (y) => Math.ceil(Math.floor(y / u) / p), m = d(c) ** 2, f = this.config.image_start_token ?? "<|image_start|>", g = this.config.image_end_token ?? "<|image_end|>", x = this.config.image_thumbnail ?? "<|img_thumbnail|>";
        Array.isArray(s) || (s = [s]);
        let w = 0;
        s = s.map((y) => {
          let b = y.split(l);
          return b[0] + b.slice(1).map((v) => {
            let k = w++, [S, I] = i[k], $ = n[k], C = o[k], q = d(S) * d(I), D = f;
            if ($ > 1 || C > 1) {
              let B = l.repeat(m);
              for (let H = 0; H < $; ++H) for (let V = 0; V < C; ++V) D += `<|img_row_${H + 1}_col_${V + 1}|>` + B;
              _ && (D += x + l.repeat(q));
            } else D += l.repeat(q);
            return D + g + v;
          }).join("");
        });
      }
      return { ...a, ...s ? this.tokenizer(s, r) : {} };
    }
  }, __publicField(_a19, "tokenizer_class", W), __publicField(_a19, "image_processor_class", pe), _a19);
  var _a20;
  var y_ = (_a20 = class extends U {
    async _call(e, s = null, r = {}) {
      let n = await this.image_processor(e, r);
      if (s) {
        let [i, a] = n.pixel_values.dims.slice(-2), { image_token: l, patch_size: c, num_additional_image_tokens: p } = this.config, u = Math.floor(i / c) * Math.floor(a / c) + p;
        s = structuredClone(s), Array.isArray(s) || (s = [s]);
        for (let _ = 0; _ < s.length; ++_) s[_] = s[_].replace(l, l.repeat(u));
      }
      let o = s ? this.tokenizer(s, r) : {};
      return { ...n, ...o };
    }
  }, __publicField(_a20, "tokenizer_class", W), __publicField(_a20, "image_processor_class", pe), __publicField(_a20, "uses_processor_config", true), _a20);
  var db = { char: ["char_decode", 1], bpe: ["bpe_decode", 2], wp: ["wp_decode", 102] };
  var _a21;
  var b_ = (_a21 = class extends U {
    get char_tokenizer() {
      return this.components.char_tokenizer;
    }
    get bpe_tokenizer() {
      return this.components.bpe_tokenizer;
    }
    get wp_tokenizer() {
      return this.components.wp_tokenizer;
    }
    _decode_helper(e, s) {
      if (!db.hasOwnProperty(s)) throw new Error(`Format ${s} is not supported.`);
      let [r, n] = db[s], o = this[r].bind(this), [i, a] = e.dims, l = [], c = [], p = e.tolist();
      for (let _ = 0; _ < i; ++_) {
        let d = p[_], m = [], f = [];
        for (let x = 1; x < a; ++x) {
          let [w, y] = de(fe(d[x]));
          if (f.push(w), y == n) break;
          m.push(y);
        }
        let g = f.length > 0 ? f.reduce((x, w) => x * w, 1) : 0;
        c.push(m), l.push(g);
      }
      return [o(c), l];
    }
    char_decode(e) {
      return this.char_tokenizer.batch_decode(e).map((s) => s.replaceAll(" ", ""));
    }
    bpe_decode(e) {
      return this.bpe_tokenizer.batch_decode(e);
    }
    wp_decode(e) {
      return this.wp_tokenizer.batch_decode(e).map((s) => s.replaceAll(" ", ""));
    }
    batch_decode([e, s, r]) {
      let [n, o] = this._decode_helper(e, "char"), [i, a] = this._decode_helper(s, "bpe"), [l, c] = this._decode_helper(r, "wp"), p = [], u = [];
      for (let _ = 0; _ < n.length; ++_) {
        let [d, m] = de([o[_], a[_], c[_]]);
        p.push([n[_], i[_], l[_]][m]), u.push(d);
      }
      return { generated_text: p, scores: u, char_preds: n, bpe_preds: i, wp_preds: l };
    }
    static async from_pretrained(...e) {
      let s = await super.from_pretrained(...e), r = await W.from_pretrained("Xenova/gpt2"), n = await W.from_pretrained("Xenova/bert-base-uncased");
      return s.components = { image_processor: s.image_processor, char_tokenizer: s.tokenizer, bpe_tokenizer: r, wp_tokenizer: n }, s;
    }
    async _call(e, s = null) {
      let r = await this.image_processor(e);
      return s && (r.labels = this.tokenizer(s).input_ids), r;
    }
  }, __publicField(_a21, "tokenizer_class", W), __publicField(_a21, "image_processor_class", pe), _a21);
  var _a22;
  var k_ = (_a22 = class extends U {
    async _call(e) {
      return await this.feature_extractor(e);
    }
  }, __publicField(_a22, "tokenizer_class", W), __publicField(_a22, "feature_extractor_class", ge), _a22);
  var _a23;
  var v_ = (_a23 = class extends U {
  }, __publicField(_a23, "tokenizer_class", W), __publicField(_a23, "image_processor_class", pe), _a23);
  var Gs = "<image>";
  function WA(t6, e, s, r, n) {
    return `${r.repeat(s * n)}${e}${t6}
`;
  }
  var _a24;
  var E_ = (_a24 = class extends U {
    async _call(e, s = null, r = {}) {
      s || (F.warn("You are using PaliGemma without a text prefix. It will perform as a picture-captioning model."), s = ""), Array.isArray(e) || (e = [e]), Array.isArray(s) || (s = [s]);
      let n = this.tokenizer.bos_token, o = this.image_processor.config.image_seq_length, i;
      s.some((c) => c.includes(Gs)) ? i = s.map((c) => {
        let p = c.replaceAll(Gs, Gs.repeat(o)), u = p.lastIndexOf(Gs), _ = u === -1 ? 0 : u + Gs.length;
        return p.slice(0, _) + n + p.slice(_) + `
`;
      }) : (F.warn("You are passing both `text` and `images` to `PaliGemmaProcessor`. The processor expects special image tokens in the text, as many tokens as there are images per each text. It is recommended to add `<image>` tokens in the very beginning of your text. For this call, we will infer how many images each text has and add special tokens."), i = s.map((c) => WA(c, n, o, Gs, e.length)));
      let a = this.tokenizer(i, r);
      return { ...await this.image_processor(e, r), ...a };
    }
  }, __publicField(_a24, "tokenizer_class", W), __publicField(_a24, "image_processor_class", pe), __publicField(_a24, "uses_processor_config", false), _a24);
  var mb = "<|image|>";
  var VA = /<\|image_\d+\|>/g;
  var _a25;
  var A_ = (_a25 = class extends U {
    async _call(e, s = null, { padding: r = true, truncation: n = true, num_crops: o = null } = {}) {
      Array.isArray(e) || (e = [e]);
      let i, a;
      if (s) {
        a = await this.image_processor(s, { num_crops: o });
        let { num_img_tokens: l } = a, c = e.map((u, _) => u.split(VA).join(mb.repeat(l[_])));
        i = this.tokenizer(c, { padding: r, truncation: n });
        let p = this.tokenizer._tokenizer.token_to_id(mb);
        i.input_ids.map_((u) => u == p ? -u : u);
      } else i = this.tokenizer(e);
      return { ...i, ...a };
    }
  }, __publicField(_a25, "image_processor_class", pe), __publicField(_a25, "tokenizer_class", W), _a25);
  var _a26;
  var M_ = (_a26 = class extends U {
    async _call(e, s = null, r = {}) {
      let n = await this.image_processor(e, r);
      if (s) {
        let [i, a] = n.pixel_values.dims.slice(-2), { image_token: l, image_break_token: c, image_end_token: p, patch_size: u, spatial_merge_size: _ } = this.config, d = u * _, m = Math.floor(i / d), f = Math.floor(a / d);
        s = structuredClone(s), Array.isArray(s) || (s = [s]);
        for (let g = 0; g < s.length; ++g) {
          let x = l.repeat(f), w = x + c, y = x + p, b = w.repeat(m - 1) + y;
          s[g] = s[g].replace(l, b);
        }
      }
      let o = s ? this.tokenizer(s, r) : {};
      return { ...n, ...o };
    }
  }, __publicField(_a26, "tokenizer_class", W), __publicField(_a26, "image_processor_class", pe), __publicField(_a26, "uses_processor_config", true), _a26);
  var _a27;
  var S_ = (_a27 = class extends U {
    async _call(e) {
      return await this.feature_extractor(e);
    }
    post_process_speaker_diarization(...e) {
      return this.feature_extractor.post_process_speaker_diarization(...e);
    }
    get sampling_rate() {
      return this.feature_extractor.config.sampling_rate;
    }
  }, __publicField(_a27, "feature_extractor_class", Xr), _a27);
  var en = class extends ls {
  };
  var O_ = class extends en {
  };
  var _a28;
  var tn = (_a28 = class extends U {
    async _call(...e) {
      return await this.image_processor(...e);
    }
    post_process_masks(...e) {
      return this.image_processor.post_process_masks(...e);
    }
    reshape_input_points(...e) {
      return this.image_processor.reshape_input_points(...e);
    }
  }, __publicField(_a28, "image_processor_class", pe), _a28);
  var Va = class extends tn {
  };
  var I_ = class extends Va {
  };
  var _a29;
  var z_ = (_a29 = class extends U {
    async _call(e) {
      return await this.feature_extractor(e);
    }
  }, __publicField(_a29, "tokenizer_class", W), __publicField(_a29, "feature_extractor_class", ge), _a29);
  var _a30;
  var T_ = (_a30 = class extends U {
    async _call(e, s = null, r = {}) {
      if (Array.isArray(e)) throw new Error("Batched inputs are not supported yet.");
      let n = {};
      if (s) {
        let i = s.length, { input_features: a } = await this.feature_extractor(s, { ...r, max_length: i }), l = Math.round(i / this.config.encoder_ds_factor + 1e-4), c = 1 + Math.ceil(l / this.config.stack_factor);
        n.audio_token_len = [c], n.audio_values = a;
        let p = this.config.audio_placeholder;
        if (!e.includes(p)) throw new Error(`The input text does not contain the image token ${p}.`);
        e = e.replaceAll(p, p.repeat(c));
      }
      return { ...this.tokenizer(e, { add_special_tokens: false, ...r }), ...n };
    }
  }, __publicField(_a30, "tokenizer_class", W), __publicField(_a30, "feature_extractor_class", ge), __publicField(_a30, "uses_processor_config", true), _a30);
  var Ha = "[AUDIO]";
  var HA = "[BEGIN_AUDIO]";
  var KA = 375;
  function XA(t6, e) {
    let s = [];
    for (let r = 0; r < t6.length; r += e) s.push(t6.subarray(r, Math.min(r + e, t6.length)));
    return s;
  }
  var _a31;
  var C_ = (_a31 = class extends U {
    async _call(e, s = null, r = {}) {
      if (Array.isArray(e)) throw new Error("Batched inputs are not supported yet.");
      let n = {};
      if (s) {
        if (!e.includes(Ha)) throw new Error(`The input text does not contain the audio token ${Ha}.`);
        Array.isArray(s) || (s = [s]);
        let i = e.split(Ha), a = i.length - 1;
        if (a !== s.length) throw new Error(`The number of audio inputs (${s.length}) does not match the number of audio tokens in the text (${a}).`);
        let l = this.feature_extractor.config.n_samples, c = s.map((m) => XA(m, l)), p = c.map((m) => m.length), u = c.flat(), _ = (await Promise.all(u.map((m) => this.feature_extractor(m, r)))).map((m) => m.input_features);
        n.audio_values = _.length > 1 ? ie(_, 0) : _[0];
        let d = i[0];
        for (let m = 0; m < p.length; ++m) {
          d += HA;
          for (let f = 0; f < p[m]; ++f) d += Ha.repeat(KA);
          d += i[m + 1];
        }
        e = d;
      }
      return { ...this.tokenizer(e, { add_special_tokens: false, ...r }), ...n };
    }
  }, __publicField(_a31, "tokenizer_class", W), __publicField(_a31, "feature_extractor_class", ge), __publicField(_a31, "uses_processor_config", false), _a31);
  var fb = 32;
  var P_ = 6;
  var Ka = 8;
  var QA = 10;
  var YA = 32;
  var _a32;
  var N_ = (_a32 = class extends U {
    get num_mel_frames_first_audio_chunk() {
      return (P_ + 1) * Ka;
    }
    get num_samples_first_audio_chunk() {
      let { hop_length: e, n_fft: s } = this.feature_extractor.config;
      return (this.num_mel_frames_first_audio_chunk - 1) * e + Math.floor(s / 2);
    }
    get num_samples_per_audio_chunk() {
      let { hop_length: e, n_fft: s } = this.feature_extractor.config;
      return Ka * e + s;
    }
    get num_right_pad_tokens() {
      return P_ + 1 + QA;
    }
    get audio_length_per_tok() {
      return Ka;
    }
    get raw_audio_length_per_tok() {
      return Ka * this.feature_extractor.config.hop_length;
    }
    async _call(e, { is_streaming: s = false, is_first_audio_chunk: r = true } = {}) {
      if (ce(e, "VoxtralRealtimeProcessor"), !s && !r) throw new Error("In non-streaming mode (`is_streaming=false`), `is_first_audio_chunk` must be `true`.");
      if (r) if (s) {
        let n = fb * this.raw_audio_length_per_tok, o = new Float32Array(n + e.length);
        o.set(e, n);
        let i = await this.feature_extractor(o, { center: true }), l = 1 + (fb + P_), c = new BigInt64Array(l).fill(BigInt(YA));
        return c[0] = 1n, { input_ids: new E("int64", c, [1, l]), ...i };
      } else {
        let n = this.num_right_pad_tokens * this.raw_audio_length_per_tok, o = new Float32Array(e.length + n);
        return o.set(e), await this.feature_extractor(o, { center: true });
      }
      else return await this.feature_extractor(e, { center: false });
    }
  }, __publicField(_a32, "tokenizer_class", W), __publicField(_a32, "feature_extractor_class", ge), __publicField(_a32, "uses_processor_config", false), _a32);
  var _a33;
  var L_ = (_a33 = class extends U {
    async _call(e) {
      return await this.feature_extractor(e);
    }
  }, __publicField(_a33, "tokenizer_class", W), __publicField(_a33, "feature_extractor_class", ge), _a33);
  var _a34;
  var $_ = (_a34 = class extends U {
    async _call(e) {
      return await this.feature_extractor(e);
    }
  }, __publicField(_a34, "tokenizer_class", W), __publicField(_a34, "feature_extractor_class", ge), _a34);
  var _a35;
  var F_ = (_a35 = class extends U {
    async _call(e) {
      return await this.feature_extractor(e);
    }
  }, __publicField(_a35, "tokenizer_class", W), __publicField(_a35, "feature_extractor_class", ge), _a35);
  var Qa = class {
    static async from_pretrained(e, s = {}) {
      let r = await Oe(e, kt, true, s), { image_processor_type: n, feature_extractor_type: o, processor_class: i } = r;
      if (i && Xa[i]) return Xa[i].from_pretrained(e, s);
      if (!n && !o) throw new Error("No `image_processor_type` or `feature_extractor_type` found in the config.");
      let a = {};
      if (n) {
        let c = Us[n.replace(/Fast$/, "")];
        if (!c) throw new Error(`Unknown image_processor_type: '${n}'.`);
        a.image_processor = new c(r);
      }
      if (o) {
        let c = Us[o];
        if (c) a.image_processor = new c(r);
        else {
          let p = Qr[o];
          if (!p) throw new Error(`Unknown feature_extractor_type: '${o}'.`);
          a.feature_extractor = new p(r);
        }
      }
      let l = {};
      return new U(l, a, null);
    }
  };
  async function JA(t6, e) {
    return await Oe(t6, "config.json", true, e);
  }
  function Ws(t6) {
    let e = {}, s = {};
    switch (t6.model_type) {
      case "llava":
      case "paligemma":
      case "gemma3":
      case "florence2":
      case "llava_onevision":
      case "idefics3":
      case "granite_speech":
      case "ultravox":
      case "voxtral":
      case "voxtral_realtime":
      case "smolvlm":
      case "gemma3n":
      case "gemma4":
      case "lfm2_vl":
      case "chatterbox":
      case "lighton_ocr":
      case "glm_ocr":
      case "mistral3":
      case "qwen2_5_vl":
      case "qwen3_vl":
      case "qwen3_vl_moe":
        s = Ws(t6.text_config);
        break;
      case "moondream1":
        s = Ws(t6.phi_config);
        break;
      case "musicgen":
        s = Ws(t6.decoder);
        break;
      case "multi_modality":
        s = Ws(t6.language_config);
        break;
      case "gpt2":
      case "gptj":
      case "jais":
      case "codegen":
      case "gpt_bigcode":
        e.num_heads = "n_head", e.num_layers = "n_layer", e.hidden_size = "n_embd";
        break;
      case "gpt_neox":
      case "stablelm":
      case "opt":
      case "falcon":
      case "modernbert-decoder":
        e.num_heads = "num_attention_heads", e.num_layers = "num_hidden_layers", e.hidden_size = "hidden_size";
        break;
      case "gpt_oss":
      case "llama":
      case "llama4_text":
      case "nanochat":
      case "apertus":
      case "arcee":
      case "afmoe":
      case "lfm2":
      case "lfm2_moe":
      case "smollm3":
      case "olmo":
      case "olmo2":
      case "olmo3":
      case "mobilellm":
      case "granite":
      case "granitemoehybrid":
      case "cohere":
      case "cohere2":
      case "mistral":
      case "voxtral_realtime_text":
      case "voxtral_realtime_encoder":
      case "starcoder2":
      case "qwen2":
      case "qwen2_moe":
      case "qwen2_vl":
      case "qwen2_vl_text":
      case "qwen2_5_vl_text":
      case "qwen3_moe":
      case "qwen3_vl_text":
      case "qwen3_vl_moe_text":
      case "phi":
      case "phi3":
      case "phi3_v":
      case "llava_qwen2":
        e.num_heads = "num_key_value_heads", e.num_layers = "num_hidden_layers", e.hidden_size = "hidden_size", e.num_attention_heads = "num_attention_heads", e.dim_kv = "head_dim";
        break;
      case "qwen3":
      case "solar_open":
      case "glm_ocr_text":
      case "gemma":
      case "gemma2":
      case "vaultgemma":
      case "gemma3_text":
      case "gemma3n_text":
      case "gemma4_text":
      case "glm":
      case "helium":
      case "ernie4_5":
      case "hunyuan_v1_dense":
      case "falcon_h1":
      case "nemotron_h":
      case "ministral":
      case "ministral3":
        e.num_heads = "num_key_value_heads", e.num_layers = "num_hidden_layers", e.dim_kv = "head_dim";
        break;
      case "openelm":
        e.num_heads = "num_kv_heads", e.num_layers = "num_transformer_layers", e.dim_kv = "head_dim";
        break;
      case "gpt_neo":
      case "donut-swin":
        e.num_heads = "num_heads", e.num_layers = "num_layers", e.hidden_size = "hidden_size";
        break;
      case "bloom":
        e.num_heads = "n_head", e.num_layers = "n_layer", e.hidden_size = "hidden_size";
        break;
      case "mpt":
        e.num_heads = "n_heads", e.num_layers = "n_layers", e.hidden_size = "d_model";
        break;
      case "exaone":
        e.num_heads = "num_key_value_heads", e.num_layers = "num_layers", e.dim_kv = "head_dim", e.num_attention_heads = "num_attention_heads";
        break;
      case "youtu":
      case "deepseek_v3":
      case "glm_moe_dsa":
      case "mistral4":
        e.num_heads = "num_key_value_heads", e.num_layers = "num_hidden_layers", e.dim_kv = "qk_head_dim", e.num_attention_heads = "num_attention_heads";
        break;
      case "t5":
      case "mt5":
      case "longt5":
        e.num_decoder_layers = "num_decoder_layers", e.num_decoder_heads = "num_heads", e.decoder_dim_kv = "d_kv", e.num_encoder_layers = "num_layers", e.num_encoder_heads = "num_heads", e.encoder_dim_kv = "d_kv";
        break;
      case "bart":
      case "mbart":
      case "marian":
      case "whisper":
      case "lite-whisper":
      case "m2m_100":
      case "blenderbot":
      case "blenderbot-small":
      case "florence2_language":
        e.num_decoder_layers = "decoder_layers", e.num_decoder_heads = "decoder_attention_heads", e.decoder_hidden_size = "d_model", e.num_encoder_layers = "encoder_layers", e.num_encoder_heads = "encoder_attention_heads", e.encoder_hidden_size = "d_model";
        break;
      case "speecht5":
        e.num_decoder_layers = "decoder_layers", e.num_decoder_heads = "decoder_attention_heads", e.decoder_hidden_size = "hidden_size", e.num_encoder_layers = "encoder_layers", e.num_encoder_heads = "encoder_attention_heads", e.encoder_hidden_size = "hidden_size";
        break;
      case "trocr":
        e.num_encoder_layers = e.num_decoder_layers = "decoder_layers", e.num_encoder_heads = e.num_decoder_heads = "decoder_attention_heads", e.encoder_hidden_size = e.decoder_hidden_size = "d_model";
        break;
      case "musicgen_decoder":
        e.num_encoder_layers = e.num_decoder_layers = "num_hidden_layers", e.num_encoder_heads = e.num_decoder_heads = "num_attention_heads", e.encoder_hidden_size = e.decoder_hidden_size = "hidden_size";
        break;
      case "moonshine":
        e.num_decoder_layers = "decoder_num_hidden_layers", e.num_decoder_heads = "decoder_num_key_value_heads", e.num_encoder_layers = "encoder_num_hidden_layers", e.num_encoder_heads = "encoder_num_key_value_heads", e.encoder_hidden_size = e.decoder_hidden_size = "hidden_size";
        break;
      case "cohere_asr":
        e.num_decoder_layers = "num_hidden_layers", e.num_decoder_heads = "num_key_value_heads", e.decoder_hidden_size = "hidden_size", e.decoder_dim_kv = "head_dim";
        let { num_hidden_layers: n, num_attention_heads: o, hidden_size: i } = t6.encoder_config;
        s = { num_encoder_layers: n, num_encoder_heads: o, encoder_hidden_size: i, encoder_dim_kv: t6.head_dim };
        break;
      case "vision-encoder-decoder":
        let a = Ws(t6.decoder), l = "num_decoder_layers" in a, c = ve(t6, ["model_type", "is_encoder_decoder"]);
        return l ? (c.num_decoder_layers = a.num_decoder_layers, c.num_decoder_heads = a.num_decoder_heads, c.decoder_hidden_size = a.decoder_hidden_size, c.num_encoder_layers = a.num_encoder_layers, c.num_encoder_heads = a.num_encoder_heads, c.encoder_hidden_size = a.encoder_hidden_size) : (c.num_layers = a.num_layers, c.num_heads = a.num_heads, c.hidden_size = a.hidden_size), c;
    }
    let r = { ...s, ...ve(t6, ["model_type", "multi_query", "is_encoder_decoder"]) };
    for (let n in e) r[n] = t6[e[n]];
    return r;
  }
  function cs(t6, e) {
    t6 instanceof Vs || (t6 = new Vs(t6));
    let s = e?.batch_size ?? 1;
    if (["lfm2", "lfm2_moe"].includes(t6.model_type)) {
      let r = e?.prefix ?? "past_key_values", n = r === "present" ? "present" : "past", o = {}, { layer_types: i, num_attention_heads: a, num_key_value_heads: l, hidden_size: c, conv_L_cache: p } = t6, u = c / a;
      for (let _ = 0; _ < i.length; ++_) if (i[_] === "full_attention") for (let d of ["key", "value"]) o[`${r}.${_}.${d}`] = [s, l, 0, u];
      else if (i[_] === "conv") o[`${n}_conv.${_}`] = [s, c, p];
      else throw new Error(`Unsupported layer type: ${i[_]}`);
      return o;
    } else if (["granitemoehybrid", "falcon_h1", "nemotron_h"].includes(t6.model_type)) {
      let r = e?.prefix ?? "past_key_values", n = r === "present" ? "present" : "past", o = t6, i = o.layer_types ?? o.layers_block_type, a = o.num_hidden_layers ?? i?.length, l = o.num_key_value_heads, c = o.head_dim ?? o.hidden_size / o.num_attention_heads, p = o.mamba_n_heads ?? o.mamba_num_heads, u = o.mamba_d_head ?? o.mamba_head_dim, _ = o.mamba_d_state ?? o.ssm_state_size, d = o.mamba_n_groups ?? o.n_groups, m = o.mamba_d_conv ?? o.conv_kernel, g = (o.mamba_d_ssm ?? (o.mamba_expand ? o.mamba_expand * o.hidden_size : p * u)) + 2 * d * _, x = {};
      for (let w = 0; w < a; ++w) if ((!i || i[w] === "mamba") && (x[`${n}_conv.${w}`] = [s, g, m], x[`${n}_ssm.${w}`] = [s, p, u, _]), !i || i[w] === "attention") for (let y of ["key", "value"]) x[`${r}.${w}.${y}`] = [s, l, 0, c];
      return x;
    } else if (["qwen3_next", "qwen3_5_text", "qwen3_5_moe_text", "olmo_hybrid"].includes(t6.model_type)) {
      let r = e?.prefix ?? "past_key_values", n = r === "present" ? "present" : "past", o = {}, { head_dim: i, layer_types: a, num_attention_heads: l, num_key_value_heads: c, hidden_size: p, linear_num_value_heads: u, linear_num_key_heads: _, linear_key_head_dim: d, linear_value_head_dim: m, linear_conv_kernel_dim: f } = t6, g = d * _, x = m * u, w = i ?? p / l;
      for (let y = 0; y < a.length; ++y) if (a[y] === "full_attention") for (let b of ["key", "value"]) o[`${r}.${y}.${b}`] = [s, c, 0, w];
      else if (a[y] === "linear_attention") {
        if (t6.model_type === "olmo_hybrid") o[`${n}_conv.${y}.key`] = [s, g, f], o[`${n}_conv.${y}.value`] = [s, x, f], o[`${n}_conv.${y}.query`] = [s, g, f];
        else {
          let b = g * 2 + x;
          o[`${n}_conv.${y}`] = [s, b, f];
        }
        o[`${n}_recurrent.${y}`] = [s, u, d, m];
      } else throw new Error(`Unsupported layer type: ${a[y]}`);
      return o;
    } else if (["gemma4", "gemma4_text"].includes(t6.model_type)) {
      let r = t6.model_type === "gemma4" ? t6.text_config : t6, n = e?.prefix ?? "past_key_values", o = {}, i = r.num_hidden_layers, a = r.num_kv_shared_layers ?? 0, l = i - a, c = r.num_key_value_heads, p = r.head_dim, u = r.global_head_dim ?? p, _ = r.layer_types ?? [];
      for (let d = 0; d < l; ++d) {
        let m = _[d] === "full_attention" ? u : p;
        for (let f of ["key", "value"]) o[`${n}.${d}.${f}`] = [s, c, 0, m];
      }
      return o;
    } else if (["lfm2_vl", "qwen3_5", "qwen3_5_moe", "voxtral_realtime"].includes(t6.model_type)) {
      let r;
      return t6.model_type === "voxtral_realtime" && e?.session_name === "audio_encoder" ? r = t6.audio_config : r = t6.text_config, cs(r, e);
    }
    return ZA(t6, e);
  }
  function ZA(t6, { prefix: e = "past_key_values", batch_size: s = 1 } = {}) {
    let r = {}, n = t6.normalized_config;
    if (n.is_encoder_decoder && "num_encoder_heads" in n && "num_decoder_heads" in n) {
      let o = n.encoder_dim_kv ?? n.encoder_hidden_size / n.num_encoder_heads, i = n.decoder_dim_kv ?? n.decoder_hidden_size / n.num_decoder_heads, a = [s, n.num_encoder_heads, 0, o], l = [s, n.num_decoder_heads, 0, i];
      for (let c = 0; c < n.num_decoder_layers; ++c) r[`${e}.${c}.encoder.key`] = a, r[`${e}.${c}.encoder.value`] = a, r[`${e}.${c}.decoder.key`] = l, r[`${e}.${c}.decoder.value`] = l;
    } else {
      let o = n.num_heads, i = n.num_layers, a = n.dim_kv ?? n.hidden_size / (n.num_attention_heads ?? o);
      if (n.model_type === "falcon") {
        let l = [s * o, 0, a];
        for (let c = 0; c < i; ++c) r[`${e}.${c}.key`] = l, r[`${e}.${c}.value`] = l;
      } else if (n.multi_query) {
        let l = [s * o, 0, 2 * a];
        for (let c = 0; c < i; ++c) r[`${e}.${c}.key_value`] = l;
      } else if (n.model_type === "bloom") {
        let l = [s * o, a, 0], c = [s * o, 0, a];
        for (let p = 0; p < i; ++p) r[`${e}.${p}.key`] = l, r[`${e}.${p}.value`] = c;
      } else if (n.model_type === "openelm") for (let l = 0; l < i; ++l) {
        let c = [s, o[l], 0, a];
        r[`${e}.${l}.key`] = c, r[`${e}.${l}.value`] = c;
      }
      else {
        let l = [s, o, 0, a];
        for (let c = 0; c < i; ++c) r[`${e}.${c}.key`] = l, r[`${e}.${c}.value`] = l;
      }
    }
    return r;
  }
  var Vs = class t4 {
    constructor(e) {
      __publicField(this, "model_type", null);
      __publicField(this, "is_encoder_decoder", false);
      __publicField(this, "max_position_embeddings");
      __publicField(this, "transformers.js_config");
      Object.assign(this, e), this.normalized_config = Ws(this);
    }
    static async from_pretrained(e, { progress_callback: s = null, config: r = null, cache_dir: n = null, local_files_only: o = false, revision: i = "main" } = {}) {
      r && !(r instanceof t4) && (r = new t4(r));
      let a = r ?? await JA(e, { progress_callback: s, config: r, cache_dir: n, local_files_only: o, revision: i });
      return new this(a);
    }
  };
  var tt = class {
    static async from_pretrained(...e) {
      return Vs.from_pretrained(...e);
    }
  };
  function R_(t6, e, s) {
    return t6 ? typeof t6 == "object" && t6 !== null ? t6.hasOwnProperty(e) ? +t6[e] : t6.hasOwnProperty(s) ? +t6[s] : 0 : +t6 : 0;
  }
  function D_(t6, e) {
    let s = [];
    for (let r = 0; r < e; ++r) s.push(`${t6}_data${r === 0 ? "" : "_" + r}`);
    return s;
  }
  async function hb(t6, e, s, r) {
    let n = `${e}${r}.onnx`, o = `${s.subfolder ?? ""}/${n}`;
    return await Nr(t6, o, true, s, K.IS_NODE_ENV);
  }
  async function gb(t6, e, s, r, n, o = {}) {
    let i = `${e}${s}.onnx`, a = K.IS_NODE_ENV, l = [], c = R_(n, i, e);
    if (c > 0) {
      if (c > aa) throw new Error(`The number of external data chunks (${c}) exceeds the maximum allowed value (${aa}).`);
      let p = D_(i, c);
      for (let u of p) {
        let _ = `${r.subfolder ?? ""}/${u}`;
        l.push(new Promise(async (d, m) => {
          let f = await Nr(t6, _, true, r, a);
          d(f instanceof Uint8Array ? { path: u, data: f } : u);
        }));
      }
    } else o.externalData !== void 0 && (l = o.externalData.map(async (p) => {
      if (typeof p.data == "string") {
        let u = await Nr(t6, p.data, true, r);
        return { ...p, data: u };
      }
      return p;
    }));
    return Promise.all(l);
  }
  async function eM(t6, e, s, r = false, n = void 0) {
    let o = s.config?.["transformers.js_config"] ?? {}, i = ha(s.device ?? o.device, e, { warn: (b) => F.info(b) }), a = B0(i), l = o.device_config ?? {};
    l.hasOwnProperty(i) && (o = { ...o, ...l[i] });
    let c = ga(s.dtype ?? o.dtype, e, i, { configDtype: o.dtype, warn: (b) => F.info(b) });
    if (Lt.hasOwnProperty(c)) {
      if (i === "webgpu" && !K.IS_NODE_ENV && c === De.fp16 && !await H0()) throw new Error(`The device (${i}) does not support fp16.`);
    } else throw new Error(`Invalid dtype: ${c}. Should be one of: ${Object.keys(De).join(", ")}`);
    let p = o.kv_cache_dtype, u = p ? typeof p == "string" ? p : p[c] ?? "float32" : void 0;
    if (u && !["float32", "float16"].includes(u)) throw new Error(`Invalid kv_cache_dtype: ${u}. Should be one of: float32, float16`);
    let _ = Lt[c], d = { ...s.session_options };
    d.executionProviders ?? (d.executionProviders = a);
    let m = o.free_dimension_overrides;
    m ? d.freeDimensionOverrides ?? (d.freeDimensionOverrides = m) : i.startsWith("webnn") && !d.freeDimensionOverrides && F.warn(`WebNN does not currently support dynamic shapes and requires 'free_dimension_overrides' to be set in config.json, preferably as a field within config["transformers.js_config"]["device_config"]["${i}"]. When 'free_dimension_overrides' is not set, you may experience significant performance degradation.`);
    let f = hb(t6, e, s, _), g = s.use_external_data_format ?? o.use_external_data_format, x = await gb(t6, e, _, s, g, d);
    if (x.length > 0 && (!K.IS_NODE_ENV || x.some((b) => typeof b != "string")) && (d.externalData = x), r && i === "webgpu" && p !== false) {
      let b = cs(s.config, { prefix: "present", session_name: n });
      if (Object.keys(b).length > 0 && !Fr()) {
        let v = {};
        for (let k in b) v[k] = "gpu-buffer";
        d.preferredOutputLocation = v;
      }
    }
    return { buffer_or_path: await f, session_options: d, session_config: { dtype: c, kv_cache_dtype: u, device: i } };
  }
  async function xb(t6, e, s, r = void 0) {
    return Object.fromEntries(await Promise.all(Object.keys(e).map(async (n) => {
      let o = r?.[n] ?? false, { buffer_or_path: i, session_options: a, session_config: l } = await eM(t6, e[n], s, o, n), c = await da(i, a, l);
      return [n, c];
    })));
  }
  function wb(t6) {
    for (let e in t6) fa(t6[e]) ? t6[e] = new E(t6[e]) : typeof t6[e] == "object" && wb(t6[e]);
    return t6;
  }
  async function X(t6, e) {
    let s = tM(t6, e);
    try {
      let r = Object.fromEntries(Object.entries(s).map(([o, i]) => {
        let a = i.ort_tensor;
        return K.IS_NODE_ENV && typeof Float16Array < "u" && a.cpuData instanceof Float16Array && (a.cpuData = new Uint16Array(a.cpuData.buffer)), [o, a];
      })), n = await ma(t6, r);
      return wb(n);
    } catch (r) {
      let n = Object.fromEntries(Object.entries(s).map(([o, i]) => {
        let a = { type: i.type, dims: i.dims, location: i.location };
        return a.location !== "gpu-buffer" && (a.data = i.data), [o, a];
      }));
      throw F.error(`An error occurred during model execution: "${r}".`), F.error("Inputs given to model:", n), r;
    }
  }
  function tM(t6, e) {
    let s = /* @__PURE__ */ Object.create(null), r = [];
    for (let i of t6.inputNames) {
      let a = e[i];
      if (!(a instanceof E)) {
        r.push(i);
        continue;
      }
      s[i] = Fr() ? a.clone() : a;
    }
    if (r.length > 0) throw new Error(`An error occurred during model execution: "Missing the following inputs: ${r.join(", ")}.`);
    let n = Object.keys(e).length, o = t6.inputNames.length;
    if (n > o) {
      let i = Object.keys(e).filter((a) => !t6.inputNames.includes(a));
      F.warn(`WARNING: Too many inputs were provided (${n} > ${o}). The following inputs will be ignored: "${i.join(", ")}".`);
    }
    return s;
  }
  var he = class {
  };
  var T = class extends he {
    constructor({ logits: e, ...s }) {
      super(), this.logits = e;
      let r = Object.values(s);
      r.length > 0 && (this.attentions = r);
    }
  };
  var se = class extends he {
    constructor({ logits: e }) {
      super(), this.logits = e;
    }
  };
  var ne = class extends he {
    constructor({ logits: e }) {
      super(), this.logits = e;
    }
  };
  var ue = class extends he {
    constructor({ start_logits: e, end_logits: s }) {
      super(), this.start_logits = e, this.end_logits = s;
    }
  };
  var Be = class extends he {
    constructor({ logits: e }) {
      super(), this.logits = e;
    }
  };
  var Ya = class extends he {
    constructor({ alphas: e }) {
      super(), this.alphas = e;
    }
  };
  var Qe = class extends xe {
    _call(e, s) {
      throw Error("`_call` should be implemented in a subclass");
    }
  };
  var sn = class extends xe {
    _call(e, s) {
      throw Error("`_call` should be implemented in a subclass");
    }
  };
  var ps = class extends xe {
    constructor() {
      super(), this.processors = [];
    }
    push(e) {
      this.processors.push(e);
    }
    extend(e) {
      this.processors.push(...e);
    }
    _call(e, s) {
      let r = s;
      for (let n of this.processors) r = n(e, r);
      return r;
    }
    [Symbol.iterator]() {
      return this.processors.values();
    }
  };
  var Ja = class extends Qe {
    constructor(e) {
      super(), this.bos_token_id = e;
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) if (e[r].length === 1) {
        let n = s[r].data;
        n.fill(-1 / 0), n[this.bos_token_id] = 0;
      }
      return s;
    }
  };
  var Za = class extends Qe {
    constructor(e, s) {
      super(), this.max_length = e, this.eos_token_id = Array.isArray(s) ? s : [s];
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) if (e[r].length === this.max_length - 1) {
        let n = s[r].data;
        n.fill(-1 / 0);
        for (let o of this.eos_token_id) n[o] = 0;
      }
      return s;
    }
  };
  var el = class extends Qe {
    constructor(e) {
      super(), this.suppress_tokens = e;
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) {
        let n = s[r].data;
        for (let o of this.suppress_tokens) n[o] = -1 / 0;
      }
      return s;
    }
  };
  var Hs = class extends Qe {
    constructor(e, s) {
      super(), this.begin_suppress_tokens = e, this.begin_index = s;
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) if (e[r].length === this.begin_index) {
        let n = s[r].data;
        for (let o of this.begin_suppress_tokens) n[o] = -1 / 0;
      }
      return s;
    }
  };
  var tl = class extends Qe {
    constructor(e, s) {
      super(), this.eos_token_id = Array.isArray(e.eos_token_id) ? e.eos_token_id[0] : e.eos_token_id, this.no_timestamps_token_id = e.no_timestamps_token_id, this.timestamp_begin = this.no_timestamps_token_id + 1, this.begin_index = s.length, s.at(-1) === this.no_timestamps_token_id && (this.begin_index -= 1), this.max_initial_timestamp_index = e.max_initial_timestamp_index;
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) {
        let n = s[r].data;
        if (n[this.no_timestamps_token_id] = -1 / 0, e[r].length === this.begin_index) {
          n.subarray(0, this.timestamp_begin).fill(-1 / 0);
          continue;
        }
        let o = e[r].slice(this.begin_index), i = o.length >= 1 && o[o.length - 1] >= this.timestamp_begin, a = o.length < 2 || o[o.length - 2] >= this.timestamp_begin;
        if (i && (a ? n.subarray(this.timestamp_begin).fill(-1 / 0) : n.subarray(0, this.eos_token_id).fill(-1 / 0)), e[r].length === this.begin_index && this.max_initial_timestamp_index !== null) {
          let u = this.timestamp_begin + this.max_initial_timestamp_index;
          n.subarray(u + 1).fill(-1 / 0);
        }
        let l = Jc(n), c = Math.log(l.subarray(this.timestamp_begin).map(Math.exp).reduce((u, _) => u + _)), p = de(l.subarray(0, this.timestamp_begin))[0];
        c > p && n.subarray(0, this.timestamp_begin).fill(-1 / 0);
      }
      return s;
    }
  };
  var sl = class extends Qe {
    constructor(e) {
      super(), this.no_repeat_ngram_size = e;
    }
    getNgrams(e) {
      let s = e.length, r = [];
      for (let o = 0; o < s + 1 - this.no_repeat_ngram_size; ++o) {
        let i = [];
        for (let a = 0; a < this.no_repeat_ngram_size; ++a) i.push(e[o + a]);
        r.push(i.map(Number));
      }
      let n = /* @__PURE__ */ new Map();
      for (let o of r) {
        let i = o.slice(0, o.length - 1), a = JSON.stringify(i), l = n.get(a) ?? [];
        l.push(o[o.length - 1]), n.set(a, l);
      }
      return n;
    }
    getGeneratedNgrams(e, s) {
      let r = s.slice(s.length + 1 - this.no_repeat_ngram_size, s.length);
      return e.get(JSON.stringify(r.map(Number))) ?? [];
    }
    calcBannedNgramTokens(e) {
      let s = [];
      if (e.length + 1 < this.no_repeat_ngram_size) return s;
      {
        let r = this.getNgrams(e);
        return this.getGeneratedNgrams(r, e);
      }
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) {
        let n = s[r].data, o = this.calcBannedNgramTokens(e[r]);
        for (let i of o) n[i] = -1 / 0;
      }
      return s;
    }
  };
  var rl = class extends Qe {
    constructor(e) {
      super(), this.penalty = e;
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) {
        let n = s[r].data;
        for (let o of new Set(e[r])) {
          let i = Number(o);
          n[i] < 0 ? n[i] *= this.penalty : n[i] /= this.penalty;
        }
      }
      return s;
    }
  };
  var nl = class extends Qe {
    constructor(e, s) {
      super(), this.min_length = e, this.eos_token_id = Array.isArray(s) ? s : [s];
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) if (e[r].length < this.min_length) {
        let n = s[r].data;
        for (let o of this.eos_token_id) n[o] = -1 / 0;
      }
      return s;
    }
  };
  var ol = class extends Qe {
    constructor(e, s, r) {
      super(), this.prompt_length_to_skip = e, this.min_new_tokens = s, this.eos_token_id = Array.isArray(r) ? r : [r];
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) if (e[r].length - this.prompt_length_to_skip < this.min_new_tokens) {
        let o = s[r].data;
        for (let i of this.eos_token_id) o[i] = -1 / 0;
      }
      return s;
    }
  };
  var il = class extends Qe {
    constructor(e, s) {
      super(), this.bad_words_ids = e, this.eos_token_id = Array.isArray(s) ? s : [s];
    }
    _call(e, s) {
      for (let r = 0; r < e.length; ++r) {
        let n = s[r].data, o = e[r];
        for (let i of this.bad_words_ids) {
          if (o.length < i.length - 1) continue;
          let a = true;
          for (let l = 1; l <= i.length - 1; ++l) if (i.at(-l - 1) != o.at(-l)) {
            a = false;
            break;
          }
          a && (n[i.at(-1)] = -1 / 0);
        }
      }
      return s;
    }
  };
  var al = class extends Qe {
    constructor(e) {
      if (super(), e <= 1) throw new Error(`Require guidance scale >1 to use the classifier free guidance processor, got guidance scale ${e}.`);
      this.guidance_scale = e;
    }
    _call(e, s) {
      if (s.dims[0] !== 2 * e.length) throw new Error(`Logits should have twice the batch size of the input ids, the first half of batches corresponding to the conditional inputs, and the second half of batches corresponding to the unconditional inputs. Got batch size ${s.dims[0]} for the logits and ${e.length} for the input ids.`);
      let r = e.length, n = s.slice([0, r], null), o = s.slice([r, s.dims[0]], null);
      for (let i = 0; i < o.data.length; ++i) o.data[i] += (n.data[i] - o.data[i]) * this.guidance_scale;
      return o;
    }
  };
  var ll = class extends sn {
    constructor(e) {
      if (super(), typeof e != "number" || e <= 0) {
        let s = `\`temperature\` (=${e}) must be a strictly positive float, otherwise your next token scores will be invalid.`;
        e === 0 && (s += " If you're looking for greedy decoding strategies, set `do_sample=false`.");
      }
      this.temperature = e;
    }
    _call(e, s) {
      let r = s.data;
      for (let n = 0; n < r.length; ++n) r[n] /= this.temperature;
      return s;
    }
  };
  var Ks = class {
    constructor(e) {
      __publicField(this, "max_length", 20);
      __publicField(this, "max_new_tokens", null);
      __publicField(this, "min_length", 0);
      __publicField(this, "min_new_tokens", null);
      __publicField(this, "early_stopping", false);
      __publicField(this, "max_time", null);
      __publicField(this, "do_sample", false);
      __publicField(this, "num_beams", 1);
      __publicField(this, "num_beam_groups", 1);
      __publicField(this, "penalty_alpha", null);
      __publicField(this, "use_cache", true);
      __publicField(this, "temperature", 1);
      __publicField(this, "top_k", 50);
      __publicField(this, "top_p", 1);
      __publicField(this, "typical_p", 1);
      __publicField(this, "epsilon_cutoff", 0);
      __publicField(this, "eta_cutoff", 0);
      __publicField(this, "diversity_penalty", 0);
      __publicField(this, "repetition_penalty", 1);
      __publicField(this, "encoder_repetition_penalty", 1);
      __publicField(this, "length_penalty", 1);
      __publicField(this, "no_repeat_ngram_size", 0);
      __publicField(this, "bad_words_ids", null);
      __publicField(this, "force_words_ids", null);
      __publicField(this, "renormalize_logits", false);
      __publicField(this, "constraints", null);
      __publicField(this, "forced_bos_token_id", null);
      __publicField(this, "forced_eos_token_id", null);
      __publicField(this, "remove_invalid_values", false);
      __publicField(this, "exponential_decay_length_penalty", null);
      __publicField(this, "suppress_tokens", null);
      __publicField(this, "streamer", null);
      __publicField(this, "begin_suppress_tokens", null);
      __publicField(this, "forced_decoder_ids", null);
      __publicField(this, "guidance_scale", null);
      __publicField(this, "num_return_sequences", 1);
      __publicField(this, "output_attentions", false);
      __publicField(this, "output_hidden_states", false);
      __publicField(this, "output_scores", false);
      __publicField(this, "return_dict_in_generate", false);
      __publicField(this, "pad_token_id", null);
      __publicField(this, "bos_token_id", null);
      __publicField(this, "eos_token_id", null);
      __publicField(this, "encoder_no_repeat_ngram_size", 0);
      __publicField(this, "decoder_start_token_id", null);
      __publicField(this, "generation_kwargs", {});
      Object.assign(this, ve(e, Object.getOwnPropertyNames(this)));
    }
  };
  var Dt = class extends xe {
    _call(e, s) {
      throw Error("StoppingCriteria needs to be subclassed");
    }
  };
  var Xs = class t5 extends xe {
    constructor() {
      super(), this.criteria = [];
    }
    push(e) {
      this.criteria.push(e);
    }
    extend(e) {
      e instanceof t5 ? e = e.criteria : e instanceof Dt && (e = [e]), this.criteria.push(...e);
    }
    _call(e, s) {
      let r = new Array(e.length).fill(false);
      for (let n of this.criteria) {
        let o = n(e, s);
        for (let i = 0; i < r.length; ++i) r[i] || (r[i] = o[i]);
      }
      return r;
    }
    [Symbol.iterator]() {
      return this.criteria.values();
    }
  };
  var cl = class extends Dt {
    constructor(e, s = null) {
      super(), this.max_length = e, this.max_position_embeddings = s;
    }
    _call(e) {
      return e.map((s) => s.length >= this.max_length);
    }
  };
  var pl = class extends Dt {
    constructor(e) {
      super(), Array.isArray(e) || (e = [e]), this.eos_token_id = e;
    }
    _call(e, s) {
      return e.map((r) => {
        let n = r.at(-1);
        return this.eos_token_id.some((o) => n == o);
      });
    }
  };
  var us = class extends xe {
    constructor(e) {
      super(), this.generation_config = e;
    }
    async _call(e) {
      return this.sample(e);
    }
    async sample(e) {
      throw Error("sample should be implemented in subclasses.");
    }
    getLogits(e, s) {
      let r = e.dims.at(-1), n = e.data;
      if (s === -1) n = n.slice(-r);
      else {
        let o = s * r;
        n = n.slice(o, o + r);
      }
      return n;
    }
    randomSelect(e) {
      return g0(e);
    }
    static getSampler(e) {
      if (e.do_sample) return new j_(e);
      if (e.num_beams > 1) return new B_(e);
      if (e.num_return_sequences > 1) throw Error(`num_return_sequences has to be 1 when doing greedy search, but is ${e.num_return_sequences}.`);
      return new q_(e);
    }
  };
  var q_ = class extends us {
    async sample(e) {
      let s = de(e.data)[1];
      return [[BigInt(s), 0]];
    }
  };
  var j_ = class extends us {
    async sample(e) {
      let s = e.dims.at(-1);
      this.generation_config.top_k > 0 && (s = Math.min(this.generation_config.top_k, s));
      let [r, n] = await lt(e, s), o = fe(r.data);
      return Array.from({ length: this.generation_config.num_beams }, () => {
        let i = this.randomSelect(o);
        return [n.data[i], Math.log(o[i])];
      });
    }
  };
  var B_ = class extends us {
    async sample(e) {
      let s = e.dims.at(-1);
      this.generation_config.top_k > 0 && (s = Math.min(this.generation_config.top_k, s));
      let [r, n] = await lt(e, s), o = fe(r.data);
      return Array.from({ length: this.generation_config.num_beams }, (i, a) => [n.data[a], Math.log(o[a])]);
    }
  };
  var U_ = class {
    constructor(e) {
      if (e) for (let s in e) {
        if (s in this) throw new TypeError(`Key "${s}" conflicts with an existing property on DynamicCache`);
        let r = e[s];
        if (!(r instanceof E)) throw new TypeError(`Expected a Tensor for key "${s}", got ${typeof r}`);
        this[s] = r;
      }
    }
    get_seq_length() {
      let e = this;
      for (let s in e) if (s.startsWith("past_key_values.")) return e[s].dims.at(-2);
      throw new Error("Unable to determine sequence length from the cache.");
    }
    async dispose() {
      let e = [];
      for (let s of Object.values(this)) s.location === "gpu-buffer" && e.push(s.dispose());
      await Promise.all(e);
    }
  };
  var rn = U_;
  var N = { EncoderOnly: 0, EncoderDecoder: 1, Seq2Seq: 2, Vision2Seq: 3, DecoderOnly: 4, DecoderOnlyWithoutHead: 5, MaskGeneration: 6, ImageTextToText: 7, Musicgen: 8, MultiModality: 9, Phi3V: 10, AudioTextToText: 11, AutoEncoder: 12, ImageAudioTextToText: 13, Supertonic: 14, Chatterbox: 15, VoxtralRealtime: 16 };
  var gt = { [N.DecoderOnly]: { sessions: (t6, e) => ({ model: e.model_file_name ?? "model" }), cache_sessions: { model: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.DecoderOnlyWithoutHead]: { sessions: (t6, e) => ({ model: e.model_file_name ?? "model" }) }, [N.Seq2Seq]: { sessions: () => ({ model: "encoder_model", decoder_model_merged: "decoder_model_merged" }), cache_sessions: { decoder_model_merged: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.Vision2Seq]: { sessions: () => ({ model: "encoder_model", decoder_model_merged: "decoder_model_merged" }), cache_sessions: { decoder_model_merged: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.Musicgen]: { sessions: () => ({ model: "text_encoder", decoder_model_merged: "decoder_model_merged", encodec_decode: "encodec_decode" }), cache_sessions: { decoder_model_merged: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.EncoderDecoder]: { sessions: () => ({ model: "encoder_model", decoder_model_merged: "decoder_model_merged" }), cache_sessions: { decoder_model_merged: true } }, [N.MaskGeneration]: { sessions: () => ({ model: "vision_encoder", prompt_encoder_mask_decoder: "prompt_encoder_mask_decoder" }) }, [N.ImageTextToText]: { text_only_sessions: { embed_tokens: "embed_tokens", decoder_model_merged: "decoder_model_merged" }, sessions: (t6, e, s) => {
    let r = { ...gt[N.ImageTextToText].text_only_sessions };
    return s || (r.vision_encoder = "vision_encoder"), t6.is_encoder_decoder && (r.model = "encoder_model"), r;
  }, cache_sessions: { decoder_model_merged: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.AudioTextToText]: { text_only_sessions: { embed_tokens: "embed_tokens", decoder_model_merged: "decoder_model_merged" }, sessions: (t6, e, s) => {
    let r = { ...gt[N.AudioTextToText].text_only_sessions };
    return s || (r.audio_encoder = "audio_encoder"), r;
  }, cache_sessions: { decoder_model_merged: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.ImageAudioTextToText]: { text_only_sessions: { embed_tokens: "embed_tokens", decoder_model_merged: "decoder_model_merged" }, sessions: (t6, e, s) => {
    let r = { ...gt[N.ImageAudioTextToText].text_only_sessions };
    return s || (r.audio_encoder = "audio_encoder", r.vision_encoder = "vision_encoder"), r;
  }, optional_configs: { generation_config: "generation_config.json" } }, [N.Phi3V]: { sessions: () => ({ prepare_inputs_embeds: "prepare_inputs_embeds", model: "model", vision_encoder: "vision_encoder" }), cache_sessions: { model: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.MultiModality]: { sessions: () => ({ prepare_inputs_embeds: "prepare_inputs_embeds", model: "language_model", lm_head: "lm_head", gen_head: "gen_head", gen_img_embeds: "gen_img_embeds", image_decode: "image_decode" }), cache_sessions: { model: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.AutoEncoder]: { sessions: () => ({ encoder_model: "encoder_model", decoder_model: "decoder_model" }) }, [N.Supertonic]: { sessions: () => ({ text_encoder: "text_encoder", latent_denoiser: "latent_denoiser", voice_decoder: "voice_decoder" }) }, [N.Chatterbox]: { sessions: () => ({ embed_tokens: "embed_tokens", speech_encoder: "speech_encoder", model: "language_model", conditional_decoder: "conditional_decoder" }), cache_sessions: { model: true }, optional_configs: { generation_config: "generation_config.json" } }, [N.VoxtralRealtime]: { text_only_sessions: { embed_tokens: "embed_tokens", decoder_model_merged: "decoder_model_merged" }, sessions: (t6, e, s) => {
    let r = { ...gt[N.VoxtralRealtime].text_only_sessions };
    return s || (r.audio_encoder = "audio_encoder"), r;
  }, cache_sessions: { decoder_model_merged: true, audio_encoder: true }, optional_configs: { generation_config: "generation_config.json" } }, default: { sessions: (t6, e) => ({ model: e.model_file_name ?? "model" }) } };
  function G_(t6) {
    return gt[t6]?.text_only_sessions ?? null;
  }
  function nn(t6, e, s = {}) {
    let r = gt[t6] ?? gt.default;
    return { sessions: r.sessions(e, s, s.textOnly ?? false), cache_sessions: r.cache_sessions, optional_configs: r.optional_configs };
  }
  function Qs(t6, { warn: e = true } = {}) {
    let s = t6.architectures || [];
    for (let r of s) {
      let n = ct.get(r);
      if (n !== void 0) return n;
    }
    if (t6.model_type) {
      let r = ct.get(t6.model_type);
      if (r !== void 0) return r;
      for (let n of Object.values(_s)) if (n.has(t6.model_type)) {
        let o = ct.get(n.get(t6.model_type));
        if (o !== void 0) return o;
      }
    }
    if (e) {
      let r = s.length > 0 ? s.join(", ") : "(none)";
      F.warn(`[resolve_model_type] Architecture(s) not found in MODEL_TYPE_MAPPING: [${r}] for model type '${t6.model_type}'. Falling back to EncoderOnly (single model.onnx file). If you encounter issues, please report at: ${$t}`);
    }
    return N.EncoderOnly;
  }
  function on(t6, { config: e = null, cache_dir: s = null, local_files_only: r = false, revision: n = "main" } = {}) {
    if (e !== null) return tt.from_pretrained(t6, { config: e, cache_dir: s, local_files_only: r, revision: n });
    let o = JSON.stringify([t6, s, r, n]);
    return ca(o, () => tt.from_pretrained(t6, { config: e, cache_dir: s, local_files_only: r, revision: n }));
  }
  async function Ys(t6, { config: e = null, dtype: s = null, device: r = null, model_file_name: n = null } = {}) {
    e = await on(t6, { config: e });
    let o = ["config.json"], i = e["transformers.js_config"] ?? {}, a = i.use_external_data_format, l = "onnx", c = r ?? i.device, p = s ?? i.dtype, u = Qs(e), _ = (f, g = null) => {
      g = g ?? f;
      let x = ha(c, f), w = ga(p, f, x), y = Lt[w] ?? "", b = `${g}${y}.onnx`, v = l ? `${l}/${b}` : b;
      o.push(v);
      let k = R_(a, b, f);
      for (let S of D_(b, k)) {
        let I = l ? `${l}/${S}` : S;
        o.push(I);
      }
    }, { sessions: d, optional_configs: m } = nn(u, e, { model_file_name: n });
    for (let [f, g] of Object.entries(d)) _(f, g);
    if (m) for (let f of Object.values(m)) o.push(f);
    return o;
  }
  var _s = null;
  function Ab(t6) {
    _s = t6;
  }
  function W_(t6) {
    if (t6 instanceof E) return t6;
    if (t6.length === 0) throw Error("items must be non-empty");
    if (Array.isArray(t6[0])) {
      if (t6.some((e) => e.length !== t6[0].length)) throw Error("Unable to create tensor, you should probably activate truncation and/or padding with 'padding=True' and/or 'truncation=True' to have batched tensors with the same length.");
      return new E("int64", BigInt64Array.from(t6.flat().map((e) => BigInt(e))), [t6.length, t6[0].length]);
    } else return new E("int64", BigInt64Array.from(t6.map((e) => BigInt(e))), [1, t6.length]);
  }
  function V_(t6) {
    return new E("bool", [t6], [1]);
  }
  var vb = { [N.DecoderOnly]: { can_generate: true, forward: Ve, prepare_inputs: Js }, [N.DecoderOnlyWithoutHead]: { can_generate: false, forward: Ve, prepare_inputs: Js }, [N.Seq2Seq]: { can_generate: true, forward: ul, prepare_inputs: an }, [N.Vision2Seq]: { can_generate: true, forward: ul, prepare_inputs: an }, [N.Musicgen]: { can_generate: true, forward: ul }, [N.EncoderDecoder]: { can_generate: false, forward: ul }, [N.ImageTextToText]: { can_generate: true, forward: nM, prepare_inputs: _l }, [N.AudioTextToText]: { can_generate: true, forward: rM, prepare_inputs: _l }, [N.ImageAudioTextToText]: { can_generate: true, prepare_inputs: _l }, [N.Phi3V]: { can_generate: true, prepare_inputs: _l }, [N.MultiModality]: { can_generate: true }, [N.AutoEncoder]: { can_generate: false, forward: sM }, [N.Chatterbox]: { can_generate: true, forward: st }, [N.VoxtralRealtime]: { can_generate: true, prepare_inputs: Js }, default: { can_generate: false, forward: st } };
  function Eb(t6, e) {
    let s = ct.get(t6), r = false, n = e?.architectures?.[0];
    if (n && n !== t6 && t6?.endsWith("ForCausalLM") && n.endsWith("ForConditionalGeneration")) {
      let a = ct.get(n);
      a !== void 0 && (s = a, r = true);
    }
    let o = vb[s] ?? vb.default, i = gt[s] ?? gt.default;
    return { typeConfig: { ...o, ...i }, textOnly: r, modelType: s };
  }
  var ct = /* @__PURE__ */ new Map();
  var dl = /* @__PURE__ */ new Map();
  var ds = /* @__PURE__ */ new Map();
  var h = class extends xe {
    constructor(e, s, r) {
      super();
      __publicField(this, "main_input_name", "input_ids");
      __publicField(this, "forward_params", ["input_ids", "attention_mask"]);
      __publicField(this, "_return_dict_in_generate_keys", null);
      this.config = e, this.sessions = s, this.configs = r;
      let n = ds.get(this.constructor), { typeConfig: o } = Eb(n, e);
      this.can_generate = o.can_generate, this._forward = o.forward, this._prepare_inputs_for_generation = o.prepare_inputs, this.can_generate && this.forward_params.push("past_key_values"), this.custom_config = this.config["transformers.js_config"] ?? {};
    }
    async dispose() {
      let e = [];
      for (let s of Object.values(this.sessions)) e.push(s.release?.());
      return await Promise.all(e);
    }
    static async from_pretrained(e, { progress_callback: s = null, config: r = null, cache_dir: n = null, local_files_only: o = false, revision: i = "main", model_file_name: a = null, subfolder: l = "onnx", device: c = null, dtype: p = null, use_external_data_format: u = null, session_options: _ = {} } = {}) {
      let d = { progress_callback: s, config: r, cache_dir: n, local_files_only: o, revision: i, model_file_name: a, subfolder: l, device: c, dtype: p, use_external_data_format: u, session_options: _ }, m = ds.get(this);
      r = d.config = await tt.from_pretrained(e, d);
      let { typeConfig: f, textOnly: g, modelType: x } = Eb(m, r);
      if (x === void 0) {
        let v = m ?? r?.model_type;
        v !== "custom" && F.warn(`Model type for '${v}' not found, assuming encoder-only architecture. Please report this at ${$t}.`);
      }
      if (s && !(s instanceof ts)) {
        let v = {};
        try {
          let k = await Ys(e, { config: r, dtype: p, device: c, model_file_name: a });
          (await Promise.all(k.map((I) => We(e, I, d)))).forEach((I, $) => {
            if (I.exists) {
              let C = k[$] === "config.json";
              v[k[$]] = { loaded: C ? I.size ?? 0 : 0, total: I.size ?? 0 };
            }
          });
        } catch (k) {
          F.warn(`Unable to fetch model file metadata for total progress tracking: ${k}`);
        }
        Object.keys(v).length > 0 && (d.progress_callback = new ts(s, v));
      }
      let w = f.sessions(r, d, g), y = [xb(e, w, d, f.cache_sessions)];
      f.optional_configs && y.push(iM(e, f.optional_configs, d));
      let b = await Promise.all(y);
      return new this(r, ...b);
    }
    async _call(e) {
      return await this.forward(e);
    }
    async forward(e) {
      return await this._forward(this, e);
    }
    get generation_config() {
      return this.configs?.generation_config ?? null;
    }
    _get_logits_processor(e, s, r = null) {
      let n = new ps();
      if (e.repetition_penalty !== null && e.repetition_penalty !== 1 && n.push(new rl(e.repetition_penalty)), e.no_repeat_ngram_size !== null && e.no_repeat_ngram_size > 0 && n.push(new sl(e.no_repeat_ngram_size)), e.bad_words_ids !== null && n.push(new il(e.bad_words_ids, e.eos_token_id)), e.min_length !== null && e.eos_token_id !== null && e.min_length > 0 && n.push(new nl(e.min_length, e.eos_token_id)), e.min_new_tokens !== null && e.eos_token_id !== null && e.min_new_tokens > 0 && n.push(new ol(s, e.min_new_tokens, e.eos_token_id)), e.forced_bos_token_id !== null && n.push(new Ja(e.forced_bos_token_id)), e.forced_eos_token_id !== null && n.push(new Za(e.max_length, e.forced_eos_token_id)), e.suppress_tokens !== null && n.push(new el(e.suppress_tokens)), e.begin_suppress_tokens !== null) {
        let o = s > 1 || e.forced_bos_token_id === null ? s : s + 1;
        n.push(new Hs(e.begin_suppress_tokens, o));
      }
      return e.guidance_scale !== null && e.guidance_scale > 1 && n.push(new al(e.guidance_scale)), e.temperature === 0 && e.do_sample && (F.warn("`do_sample` changed to false because `temperature: 0` implies greedy sampling (always selecting the most likely token), which is incompatible with `do_sample: true`."), e.do_sample = false), e.do_sample && e.temperature !== null && e.temperature !== 1 && n.push(new ll(e.temperature)), r !== null && n.extend(r), n;
    }
    _prepare_generation_config(e, s, r = Ks) {
      let n = { ...this.config };
      for (let i of ["decoder", "generator", "text_config"]) i in n && Object.assign(n, n[i]);
      let o = new r(n);
      return Object.assign(o, this.generation_config ?? {}), e && Object.assign(o, e), s && Object.assign(o, ve(s, Object.getOwnPropertyNames(o))), o;
    }
    _get_stopping_criteria(e, s = null) {
      let r = new Xs();
      return e.max_length !== null && r.push(new cl(e.max_length, this.config.max_position_embeddings ?? null)), e.eos_token_id !== null && r.push(new pl(e.eos_token_id)), s && r.extend(s), r;
    }
    _validate_model_class() {
      if (!this.can_generate) {
        let e = [_s.MODEL_FOR_CAUSAL_LM_MAPPING_NAMES, _s.MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES, _s.MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES, _s.MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES].filter(Boolean), s = ds.get(this.constructor), r = /* @__PURE__ */ new Set(), n = this.config.model_type;
        for (let i of e) {
          let a = i?.get(n);
          a && r.add(a);
        }
        let o = `The current model class (${s}) is not compatible with \`.generate()\`, as it doesn't have a language model head.`;
        throw r.size > 0 && (o += ` Please use the following class instead: ${[...r].join(", ")}`), Error(o);
      }
    }
    prepare_inputs_for_generation(...e) {
      if (!this._prepare_inputs_for_generation) throw new Error("prepare_inputs_for_generation is not implemented for this model.");
      return this._prepare_inputs_for_generation(this, ...e);
    }
    _update_model_kwargs_for_generation({ generated_input_ids: e, outputs: s, model_inputs: r, is_encoder_decoder: n }) {
      return r.past_key_values = this.getPastKeyValues(s, r.past_key_values), r.input_ids = new E("int64", e.flat(), [e.length, 1]), n ? "decoder_attention_mask" in r && (r.decoder_attention_mask = ie([r.decoder_attention_mask, Me([r.decoder_attention_mask.dims[0], 1])], 1)) : r.attention_mask = ie([r.attention_mask, Me([r.attention_mask.dims[0], 1])], 1), r.position_ids = null, r;
    }
    _prepare_model_inputs({ inputs: e, bos_token_id: s, model_kwargs: r }) {
      let n = ve(r, this.forward_params), o = this.main_input_name;
      if (o in n) {
        if (e) throw new Error("`inputs`: {inputs}` were passed alongside {input_name} which is not allowed. Make sure to either pass {inputs} or {input_name}=...");
      } else n[o] = e;
      return { inputs_tensor: n[o], model_inputs: n, model_input_name: o };
    }
    async _prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: e, model_inputs: s, model_input_name: r, generation_config: n }) {
      if (this.sessions.model.inputNames.includes("inputs_embeds") && !s.inputs_embeds && "_prepare_inputs_embeds" in this) {
        let { input_ids: i, pixel_values: a, attention_mask: l, ...c } = s, p = await this._prepare_inputs_embeds(s);
        s = { ...c, ...ve(p, ["inputs_embeds", "attention_mask"]) };
      }
      let { last_hidden_state: o } = await st(this, s);
      if (n.guidance_scale !== null && n.guidance_scale > 1) o = ie([o, Dr(o, 0)], 0), "attention_mask" in s && (s.attention_mask = ie([s.attention_mask, ap(s.attention_mask)], 0));
      else if (s.decoder_input_ids) {
        let i = W_(s.decoder_input_ids).dims[0];
        if (i !== o.dims[0]) {
          if (o.dims[0] !== 1) throw new Error(`The encoder outputs have a different batch size (${o.dims[0]}) than the decoder inputs (${i}).`);
          o = ie(Array.from({ length: i }, () => o), 0);
        }
      }
      return s.encoder_outputs = o, s;
    }
    _prepare_decoder_input_ids_for_generation({ batch_size: e, model_input_name: s, model_kwargs: r, decoder_start_token_id: n, bos_token_id: o, generation_config: i }) {
      let { decoder_input_ids: a, ...l } = r;
      if (!(a instanceof E)) {
        if (a) Array.isArray(a[0]) || (a = Array.from({ length: e }, () => a));
        else if (n ?? (n = o), this.config.model_type === "musicgen") a = Array.from({ length: e * this.config.decoder.num_codebooks }, () => [n]);
        else if (Array.isArray(n)) {
          if (n.length !== e) throw new Error(`\`decoder_start_token_id\` expcted to have length ${e} but got ${n.length}`);
          a = n;
        } else a = Array.from({ length: e }, () => [n]);
        a = W_(a);
      }
      return l.decoder_attention_mask = ba(a), { input_ids: a, model_inputs: l };
    }
    async generate({ inputs: e = null, generation_config: s = null, logits_processor: r = null, stopping_criteria: n = null, streamer: o = null, ...i }) {
      this._validate_model_class(), s = this._prepare_generation_config(s, i);
      let { inputs_tensor: a, model_inputs: l, model_input_name: c } = this._prepare_model_inputs({ inputs: e, model_kwargs: i }), p = this.config.is_encoder_decoder;
      p && ("encoder_outputs" in l || (l = await this._prepare_encoder_decoder_kwargs_for_generation({ inputs_tensor: a, model_inputs: l, model_input_name: c, generation_config: s })));
      let u;
      p ? { input_ids: u, model_inputs: l } = this._prepare_decoder_input_ids_for_generation({ batch_size: l[c].dims.at(0), model_input_name: c, model_kwargs: l, decoder_start_token_id: s.decoder_start_token_id, bos_token_id: s.bos_token_id, generation_config: s }) : u = l[c];
      let _ = u.dims.at(-1);
      s.max_new_tokens !== null && (s.max_length = _ + s.max_new_tokens);
      let d = this._get_logits_processor(s, _, r), m = this._get_stopping_criteria(s, n), f = l[c].dims.at(0), g = us.getSampler(s), x = new Array(f).fill(0), w = u.tolist();
      o && o.put(w);
      let y, b = {}, v = {};
      for (; ; ) {
        if (l = this.prepare_inputs_for_generation(w, l, s), y = await this.forward(l), s.return_dict_in_generate) if (s.output_attentions) {
          let D = this.getAttentions(y);
          for (let B in D) B in b || (b[B] = []), b[B].push(D[B]);
        } else this._return_dict_in_generate_keys && Object.assign(v, ve(y, this._return_dict_in_generate_keys));
        let I = y.logits.slice(null, -1, null).to("float32"), $ = d(w, I), C = [];
        for (let D = 0; D < $.dims.at(0); ++D) {
          let B = $[D], H = await g(B);
          for (let [V, Z] of H) {
            let R = BigInt(V);
            x[D] += Z, w[D].push(R), C.push([R]);
            break;
          }
        }
        if (o && o.put(C), m(w).every((D) => D)) break;
        l = this._update_model_kwargs_for_generation({ generated_input_ids: C, outputs: y, model_inputs: l, is_encoder_decoder: p });
      }
      o && o.end();
      let k = this.getPastKeyValues(y, l.past_key_values, true), S = new E("int64", w.flat(), [w.length, w[0].length]);
      if (s.return_dict_in_generate) return { sequences: S, past_key_values: k, ...b, ...v };
      for (let I of Object.values(y)) I.location === "gpu-buffer" && I.dispose();
      return S;
    }
    getPastKeyValues(e, s, r = false) {
      let n = /* @__PURE__ */ Object.create(null);
      for (let o in e) if (o.startsWith("present")) {
        let i = o.replace("present_ssm", "past_ssm").replace("present_conv", "past_conv").replace("present_recurrent", "past_recurrent").replace("present", "past_key_values"), a = o.includes("encoder");
        if (a && s ? n[i] = s[i] : n[i] = e[o], s && (!a || r)) {
          let l = s[i];
          l.location === "gpu-buffer" && l.dispose();
        }
      }
      return new rn(n);
    }
    getAttentions(e) {
      let s = {};
      for (let r of ["cross_attentions", "encoder_attentions", "decoder_attentions"]) for (let n in e) n.startsWith(r) && (r in s || (s[r] = []), s[r].push(e[n]));
      return s;
    }
    addPastKeyValues(e, s) {
      if (s) Object.assign(e, s);
      else {
        let r = this.sessions.decoder_model_merged ?? this.sessions.model, n = (e[this.main_input_name] ?? e.attention_mask)?.dims?.[0] ?? 1, o = r?.config?.kv_cache_dtype ?? "float32", i = o === "float16" ? bt.float16 : bt.float32, a = cs(this.config, { batch_size: n });
        for (let l in a) {
          let c = a[l].reduce((p, u) => p * u, 1);
          e[l] = new E(o, new i(c), a[l]);
        }
      }
    }
    async _encode_input(e, s, r) {
      if (!Object.hasOwn(this.sessions, e)) throw new Error(`Model does not have a ${e} session.`);
      let n = this.sessions[e];
      return (await X(n, ve(s, n.inputNames)))[r];
    }
    async encode_image(e) {
      return this._encode_input("vision_encoder", e, "image_features");
    }
    async encode_text(e) {
      return this._encode_input("embed_tokens", e, "inputs_embeds");
    }
    async encode_audio(e) {
      return this._encode_input("audio_encoder", e, "audio_features");
    }
  };
  async function ul(t6, e) {
    let { encoder_outputs: s, input_ids: r, decoder_input_ids: n, decoder_attention_mask: o, ...i } = e;
    if (!s) {
      let a = ve(e, t6.sessions.model.inputNames);
      s = (await st(t6, a)).last_hidden_state;
    }
    return i.input_ids = n, i.encoder_hidden_states = s, t6.sessions.decoder_model_merged.inputNames.includes("encoder_attention_mask") && (i.encoder_attention_mask = e.attention_mask), o && !i.attention_mask && (i.attention_mask = o), await Ve(t6, i, true);
  }
  async function st(t6, e) {
    let s = t6.sessions.model, r = ve(e, s.inputNames);
    if (s.inputNames.includes("inputs_embeds") && !r.inputs_embeds) {
      if (!e.input_ids) throw new Error("Both `input_ids` and `inputs_embeds` are missing in the model inputs.");
      r.inputs_embeds = await t6.encode_text({ input_ids: e.input_ids });
    }
    if (s.inputNames.includes("token_type_ids") && !r.token_type_ids) {
      if (!r.input_ids) throw new Error("Both `input_ids` and `token_type_ids` are missing in the model inputs.");
      r.token_type_ids = ap(r.input_ids);
    }
    if (s.inputNames.includes("pixel_mask") && !r.pixel_mask) {
      if (!r.pixel_values) throw new Error("Both `pixel_values` and `pixel_mask` are missing in the model inputs.");
      let n = r.pixel_values.dims;
      r.pixel_mask = Me([n[0], n[2], n[3]]);
    }
    return await X(s, r);
  }
  async function sM(t6, e) {
    let s = await t6.encode(e);
    return await t6.decode(s);
  }
  async function Ve(t6, e, s = false) {
    let r = t6.sessions[s ? "decoder_model_merged" : "model"], { past_key_values: n, ...o } = e;
    if (r.inputNames.includes("use_cache_branch") && (o.use_cache_branch = V_(!!n)), r.inputNames.includes("position_ids") && o.attention_mask && !o.position_ids) {
      let a = ["paligemma", "gemma3_text", "gemma3"].includes(t6.config.model_type) ? 1 : 0;
      o.position_ids = oM(o, n, a);
    }
    r.inputNames.includes("num_logits_to_keep") && !o.num_logits_to_keep && (o.num_logits_to_keep = new E("int64", [0n], [])), t6.addPastKeyValues(o, n);
    let i = ve(o, r.inputNames);
    return await X(r, i);
  }
  async function Mb(t6, { encode_function: e, merge_function: s, modality_input_names: r, modality_output_name: n, input_ids: o = null, attention_mask: i = null, position_ids: a = null, inputs_embeds: l = null, past_key_values: c = null, generation_config: p = null, logits_processor: u = null, ..._ }) {
    if (!l) {
      l = await t6.encode_text({ input_ids: o, ..._ });
      let m = ve(_, r);
      if (Object.keys(m).length > 0) {
        if (o.dims[1] !== 1) {
          let f = await e({ ...m, ..._ });
          ({ inputs_embeds: l, attention_mask: i } = s({ [n]: f, inputs_embeds: l, input_ids: o, attention_mask: i }));
        } else if (c && o.dims[1] === 1) {
          let f = o.dims[1], g = c.get_seq_length();
          i = ie([Me([o.dims[0], g]), i.slice(null, [i.dims[1] - f, i.dims[1]])], 1);
        }
      }
    }
    if (!a && ["qwen2_vl", "qwen2_vl_text", "qwen2_5_vl", "qwen2_5_vl_text", "qwen3_vl", "qwen3_vl_text", "qwen3_vl_moe", "qwen3_vl_moe_text", "qwen3_5", "qwen3_5_text", "qwen3_5_moe", "qwen3_5_moe_text", "glm_ocr", "glm_ocr_text"].includes(t6.config.model_type)) {
      let { image_grid_thw: m, video_grid_thw: f } = _;
      [a] = t6.get_rope_index(o, m, f, i);
    }
    return await Ve(t6, { inputs_embeds: l, past_key_values: c, attention_mask: i, position_ids: a, generation_config: p, logits_processor: u }, true);
  }
  async function rM(t6, e) {
    return await Mb(t6, { ...e, modality_input_names: ["audio_values", "input_features"], modality_output_name: "audio_features", encode_function: t6.encode_audio.bind(t6), merge_function: t6._merge_input_ids_with_audio_features.bind(t6) });
  }
  async function nM(t6, e) {
    return await Mb(t6, { ...e, modality_input_names: ["pixel_values"], modality_output_name: "image_features", encode_function: t6.encode_image.bind(t6), merge_function: t6._merge_input_ids_with_image_features.bind(t6) });
  }
  function H_(t6, e = 0) {
    let [s, r] = t6.dims, n = t6.data, o = new BigInt64Array(n.length);
    for (let i = 0; i < s; ++i) {
      let a = i * r, l = BigInt(e);
      for (let c = 0; c < r; ++c) {
        let p = a + c;
        n[p] === 0n ? o[p] = BigInt(1) : (o[p] = l, l += n[p]);
      }
    }
    return { data: o, dims: t6.dims };
  }
  function oM(t6, e = null, s = 0) {
    let { input_ids: r, inputs_embeds: n, attention_mask: o } = t6, { data: i, dims: a } = H_(o, s), l = new E("int64", i, a);
    if (e) {
      let c = -(r ?? n).dims.at(1);
      l = l.slice(null, [c, null]);
    }
    return l;
  }
  function Js(t6, e, s, r) {
    let n = s.past_key_values ? s.past_key_values.get_seq_length() : 0;
    if ((t6.sessions.decoder_model_merged ?? t6.sessions.model)?.inputNames.includes("num_logits_to_keep") && !s.num_logits_to_keep && (s.num_logits_to_keep = new E("int64", [1n], [])), !s.attention_mask) {
      let i;
      for (let a of ["input_ids", "inputs_embeds", "position_ids"]) if (s[a]) {
        i = s[a].dims;
        break;
      }
      if (!i) throw new Error("attention_mask is not provided, and unable to infer its shape from model inputs.");
      s.attention_mask = Me([i[0], n + i[1]]);
    }
    if (s.past_key_values) {
      let { input_ids: i, attention_mask: a } = s;
      a && a.dims[1] > i.dims[1] || n < i.dims[1] && (s.input_ids = i.slice(null, [n, null]));
    }
    return s;
  }
  function an(t6, e, s, r) {
    return s.past_key_values && (e = e.map((n) => [n.at(-1)])), { ...s, decoder_input_ids: W_(e) };
  }
  function _l(t6, ...e) {
    return t6.config.is_encoder_decoder ? an(t6, ...e) : Js(t6, ...e);
  }
  function Sb({ modality_token_id: t6, inputs_embeds: e, modality_features: s, input_ids: r, attention_mask: n }) {
    let o = r.tolist().map((c) => c.reduce((p, u, _) => (u == t6 && p.push(_), p), [])), i = o.reduce((c, p) => c + p.length, 0), a = s.dims[0];
    if (i !== a) throw new Error(`Number of tokens and features do not match: tokens: ${i}, features ${a}`);
    let l = 0;
    for (let c = 0; c < o.length; ++c) {
      let p = o[c], u = e[c];
      for (let _ = 0; _ < p.length; ++_) u[p[_]].data.set(s[l++].data);
    }
    return { inputs_embeds: e, attention_mask: n };
  }
  function Zs({ image_token_id: t6, inputs_embeds: e, image_features: s, input_ids: r, attention_mask: n }) {
    return Sb({ modality_token_id: t6, inputs_embeds: e, modality_features: s, input_ids: r, attention_mask: n });
  }
  function ml({ audio_token_id: t6, inputs_embeds: e, audio_features: s, input_ids: r, attention_mask: n }) {
    return Sb({ modality_token_id: t6, inputs_embeds: e, modality_features: s, input_ids: r, attention_mask: n });
  }
  async function iM(t6, e, s) {
    return Object.fromEntries(await Promise.all(Object.keys(e).map(async (r) => {
      let n = await Oe(t6, e[r], false, s);
      return [r, n];
    })));
  }
  var vi = {};
  Os(vi, { ASTForAudioClassification: () => od, ASTModel: () => nd, ASTPreTrainedModel: () => un, AfmoeForCausalLM: () => td, AfmoeModel: () => ed, AfmoePreTrainedModel: () => cn, AlbertForMaskedLM: () => Y_, AlbertForQuestionAnswering: () => Q_, AlbertForSequenceClassification: () => X_, AlbertModel: () => K_, AlbertPreTrainedModel: () => ms, ApertusForCausalLM: () => Z_, ApertusModel: () => J_, ApertusPreTrainedModel: () => ln, ArceeForCausalLM: () => rd, ArceeModel: () => sd, ArceePreTrainedModel: () => pn, BartForConditionalGeneration: () => ad, BartForSequenceClassification: () => ld, BartModel: () => id, BartPretrainedModel: () => er, BeitForImageClassification: () => pd, BeitModel: () => cd, BeitPreTrainedModel: () => _n, BertForMaskedLM: () => _d, BertForQuestionAnswering: () => fd, BertForSequenceClassification: () => dd, BertForTokenClassification: () => md, BertModel: () => ud, BertPreTrainedModel: () => qt, BlenderbotForConditionalGeneration: () => gd, BlenderbotModel: () => hd, BlenderbotPreTrainedModel: () => dn, BlenderbotSmallForConditionalGeneration: () => wd, BlenderbotSmallModel: () => xd, BlenderbotSmallPreTrainedModel: () => mn, BloomForCausalLM: () => bd, BloomModel: () => yd, BloomPreTrainedModel: () => fn, CHMv2ForDepthEstimation: () => Od, CHMv2PreTrainedModel: () => gl, CLIPModel: () => zd, CLIPPreTrainedModel: () => xt, CLIPSegForImageSegmentation: () => Ld, CLIPSegModel: () => Nd, CLIPSegPreTrainedModel: () => yn, CLIPTextModel: () => Td, CLIPTextModelWithProjection: () => wn, CLIPVisionModel: () => Cd, CLIPVisionModelWithProjection: () => Pd, CamembertForMaskedLM: () => vd, CamembertForQuestionAnswering: () => Md, CamembertForSequenceClassification: () => Ed, CamembertForTokenClassification: () => Ad, CamembertModel: () => kd, CamembertPreTrainedModel: () => jt, ChatterboxModel: () => hn, ChatterboxPreTrainedModel: () => fl, ChineseCLIPModel: () => Sd, ChineseCLIPPreTrainedModel: () => hl, ClapAudioModelWithProjection: () => xn, ClapModel: () => Id, ClapPreTrainedModel: () => tr, ClapTextModelWithProjection: () => gn, CodeGenForCausalLM: () => Fd, CodeGenModel: () => $d, CodeGenPreTrainedModel: () => bn, Cohere2ForCausalLM: () => jd, Cohere2Model: () => qd, Cohere2PreTrainedModel: () => vn, CohereAsrForConditionalGeneration: () => Ud, CohereAsrModel: () => Bd, CohereAsrPreTrainedModel: () => En, CohereForCausalLM: () => Dd, CohereModel: () => Rd, CoherePreTrainedModel: () => kn, ConvBertForMaskedLM: () => Wd, ConvBertForQuestionAnswering: () => Kd, ConvBertForSequenceClassification: () => Vd, ConvBertForTokenClassification: () => Hd, ConvBertModel: () => Gd, ConvBertPreTrainedModel: () => Bt, ConvNextForImageClassification: () => Qd, ConvNextModel: () => Xd, ConvNextPreTrainedModel: () => An, ConvNextV2ForImageClassification: () => Jd, ConvNextV2Model: () => Yd, ConvNextV2PreTrainedModel: () => Mn, DFineForObjectDetection: () => sm, DFineModel: () => tm, DFinePreTrainedModel: () => On, DINOv3ConvNextModel: () => Om, DINOv3ConvNextPreTrainedModel: () => El, DINOv3ViTModel: () => Im, DINOv3ViTPreTrainedModel: () => Al, DPTForDepthEstimation: () => Fm, DPTModel: () => $m, DPTPreTrainedModel: () => Ln, DacDecoderModel: () => zn, DacDecoderOutput: () => wl, DacEncoderModel: () => In, DacEncoderOutput: () => xl, DacModel: () => rm, DacPreTrainedModel: () => sr, DebertaForMaskedLM: () => om, DebertaForQuestionAnswering: () => lm, DebertaForSequenceClassification: () => im, DebertaForTokenClassification: () => am, DebertaModel: () => nm, DebertaPreTrainedModel: () => Ut, DebertaV2ForMaskedLM: () => _m, DebertaV2ForQuestionAnswering: () => fm, DebertaV2ForSequenceClassification: () => dm, DebertaV2ForTokenClassification: () => mm, DebertaV2Model: () => um, DebertaV2PreTrainedModel: () => Gt, DecisionTransformerModel: () => hm, DecisionTransformerPreTrainedModel: () => yl, DeepseekV3ForCausalLM: () => pm, DeepseekV3Model: () => cm, DeepseekV3PreTrainedModel: () => Tn, DeiTForImageClassification: () => xm, DeiTModel: () => gm, DeiTPreTrainedModel: () => Cn, DepthAnythingForDepthEstimation: () => wm, DepthAnythingPreTrainedModel: () => bl, DepthProForDepthEstimation: () => ym, DepthProPreTrainedModel: () => kl, DetrForObjectDetection: () => km, DetrForSegmentation: () => vm, DetrModel: () => bm, DetrObjectDetectionOutput: () => nr, DetrPreTrainedModel: () => rr, DetrSegmentationOutput: () => vl, Dinov2ForImageClassification: () => Am, Dinov2Model: () => Em, Dinov2PreTrainedModel: () => Pn, Dinov2WithRegistersForImageClassification: () => Sm, Dinov2WithRegistersModel: () => Mm, Dinov2WithRegistersPreTrainedModel: () => Nn, DistilBertForMaskedLM: () => Nm, DistilBertForQuestionAnswering: () => Pm, DistilBertForSequenceClassification: () => Tm, DistilBertForTokenClassification: () => Cm, DistilBertModel: () => zm, DistilBertPreTrainedModel: () => Wt, DonutSwinModel: () => Lm, DonutSwinPreTrainedModel: () => Ml, EdgeTamModel: () => Kx, EfficientNetForImageClassification: () => Dm, EfficientNetModel: () => Rm, EfficientNetPreTrainedModel: () => $n, ElectraForMaskedLM: () => jm, ElectraForQuestionAnswering: () => Gm, ElectraForSequenceClassification: () => Bm, ElectraForTokenClassification: () => Um, ElectraModel: () => qm, ElectraPreTrainedModel: () => Vt, Ernie4_5ForCausalLM: () => Vm, Ernie4_5Model: () => Wm, Ernie4_5PretrainedModel: () => Fn, EsmForMaskedLM: () => Km, EsmForSequenceClassification: () => Xm, EsmForTokenClassification: () => Qm, EsmModel: () => Hm, EsmPreTrainedModel: () => fs, EuroBertForMaskedLM: () => Jm, EuroBertForSequenceClassification: () => Zm, EuroBertForTokenClassification: () => ef, EuroBertModel: () => Ym, EuroBertPreTrainedModel: () => hs, ExaoneForCausalLM: () => sf, ExaoneModel: () => tf, ExaonePreTrainedModel: () => Rn, FalconForCausalLM: () => nf, FalconH1ForCausalLM: () => af, FalconH1Model: () => of, FalconH1PreTrainedModel: () => qn, FalconModel: () => rf, FalconPreTrainedModel: () => Dn, FastViTForImageClassification: () => cf, FastViTModel: () => lf, FastViTPreTrainedModel: () => jn, Florence2ForConditionalGeneration: () => pf, Florence2PreTrainedModel: () => Sl, GLPNForDepthEstimation: () => Sf, GLPNModel: () => Mf, GLPNPreTrainedModel: () => Kn, GPT2LMHeadModel: () => Ff, GPT2Model: () => $f, GPT2PreTrainedModel: () => Zn, GPTBigCodeForCausalLM: () => If, GPTBigCodeModel: () => Of, GPTBigCodePreTrainedModel: () => Xn, GPTJForCausalLM: () => Df, GPTJModel: () => Rf, GPTJPreTrainedModel: () => eo, GPTNeoForCausalLM: () => Tf, GPTNeoModel: () => zf, GPTNeoPreTrainedModel: () => Qn, GPTNeoXForCausalLM: () => Pf, GPTNeoXModel: () => Cf, GPTNeoXPreTrainedModel: () => Yn, Gemma2ForCausalLM: () => mf, Gemma2Model: () => df, Gemma2PreTrainedModel: () => Un, Gemma3ForCausalLM: () => xf, Gemma3ForConditionalGeneration: () => zl, Gemma3Model: () => gf, Gemma3PreTrainedModel: () => Il, Gemma3nForCausalLM: () => wf, Gemma3nForConditionalGeneration: () => Ht, Gemma3nPreTrainedModel: () => Tl, Gemma4ForCausalLM: () => yf, Gemma4ForConditionalGeneration: () => or, GemmaForCausalLM: () => _f, GemmaModel: () => uf, GemmaPreTrainedModel: () => Bn, GlmForCausalLM: () => kf, GlmModel: () => bf, GlmMoeDsaForCausalLM: () => Ef, GlmMoeDsaModel: () => vf, GlmMoeDsaPreTrainedModel: () => Wn, GlmOcrForConditionalGeneration: () => Af, GlmPreTrainedModel: () => Gn, GptOssForCausalLM: () => Lf, GptOssModel: () => Nf, GptOssPreTrainedModel: () => Jn, GraniteForCausalLM: () => jf, GraniteModel: () => qf, GraniteMoeHybridForCausalLM: () => Uf, GraniteMoeHybridModel: () => Bf, GraniteMoeHybridPreTrainedModel: () => so, GranitePreTrainedModel: () => to, GraniteSpeechForConditionalGeneration: () => Gf, GroundingDinoForObjectDetection: () => Wf, GroundingDinoPreTrainedModel: () => Nl, GroupViTModel: () => Vf, GroupViTPreTrainedModel: () => Ll, HeliumForCausalLM: () => Kf, HeliumModel: () => Hf, HeliumPreTrainedModel: () => ro, HieraForImageClassification: () => Qf, HieraModel: () => Xf, HieraPreTrainedModel: () => no, HubertForCTC: () => rh, HubertForSequenceClassification: () => nh, HubertModel: () => sh, HubertPreTrainedModel: () => th, HunYuanDenseV1ForCausalLM: () => ih, HunYuanDenseV1Model: () => oh, HunYuanDenseV1PreTrainedModel: () => oo, IJepaForImageClassification: () => ch, IJepaModel: () => lh, IJepaPreTrainedModel: () => io, Idefics3ForConditionalGeneration: () => ah, JAISLMHeadModel: () => uh, JAISModel: () => ph, JAISPreTrainedModel: () => ao, JinaCLIPModel: () => _h, JinaCLIPPreTrainedModel: () => ar, JinaCLIPTextModel: () => lo, JinaCLIPVisionModel: () => dh, Lfm2ForCausalLM: () => fh, Lfm2Model: () => mh, Lfm2MoeForCausalLM: () => xh, Lfm2MoeModel: () => gh, Lfm2MoePreTrainedModel: () => po, Lfm2PreTrainedModel: () => co, Lfm2VlForConditionalGeneration: () => wh, LightOnOcrForConditionalGeneration: () => hh, LiteWhisperForConditionalGeneration: () => cy, Llama4ForCausalLM: () => kh, Llama4PreTrainedModel: () => $l, LlamaForCausalLM: () => bh, LlamaModel: () => yh, LlamaPreTrainedModel: () => uo, LlavaForConditionalGeneration: () => Ue, LlavaOnevisionForConditionalGeneration: () => Ue, LlavaPreTrainedModel: () => Ol, LlavaQwen2ForCausalLM: () => hf, LongT5ForConditionalGeneration: () => Eh, LongT5Model: () => vh, LongT5PreTrainedModel: () => _o, M2M100ForConditionalGeneration: () => Mh, M2M100Model: () => Ah, M2M100PreTrainedModel: () => mo, MBartForCausalLM: () => Nh, MBartForConditionalGeneration: () => Ch, MBartForSequenceClassification: () => Ph, MBartModel: () => Th, MBartPreTrainedModel: () => ws, MPNetForMaskedLM: () => yg, MPNetForQuestionAnswering: () => vg, MPNetForSequenceClassification: () => bg, MPNetForTokenClassification: () => kg, MPNetModel: () => wg, MPNetPreTrainedModel: () => Kt, MT5ForConditionalGeneration: () => Sg, MT5Model: () => Mg, MT5PreTrainedModel: () => So, MarianMTModel: () => Oh, MarianModel: () => Sh, MarianPreTrainedModel: () => fo, MaskFormerForInstanceSegmentation: () => zh, MaskFormerModel: () => Ih, MaskFormerPreTrainedModel: () => ho, Metric3DForDepthEstimation: () => Lh, Metric3DPreTrainedModel: () => Fl, Metric3Dv2ForDepthEstimation: () => $h, Metric3Dv2PreTrainedModel: () => Rl, MgpstrForSceneTextRecognition: () => Fh, MgpstrModelOutput: () => Dl, MgpstrPreTrainedModel: () => ql, MimiDecoderModel: () => xo, MimiDecoderOutput: () => Bl, MimiEncoderModel: () => go, MimiEncoderOutput: () => jl, MimiModel: () => Rh, MimiPreTrainedModel: () => lr, Mistral4ForCausalLM: () => Bh, Mistral4Model: () => jh, Mistral4PreTrainedModel: () => yo, MistralForCausalLM: () => qh, MistralModel: () => Dh, MistralPreTrainedModel: () => wo, MobileBertForMaskedLM: () => Gh, MobileBertForQuestionAnswering: () => Vh, MobileBertForSequenceClassification: () => Wh, MobileBertModel: () => Uh, MobileBertPreTrainedModel: () => ys, MobileLLMForCausalLM: () => Kh, MobileLLMModel: () => Hh, MobileLLMPreTrainedModel: () => bo, MobileNetV1ForImageClassification: () => Qh, MobileNetV1ForSemanticSegmentation: () => Yh, MobileNetV1Model: () => Xh, MobileNetV1PreTrainedModel: () => cr, MobileNetV2ForImageClassification: () => Zh, MobileNetV2ForSemanticSegmentation: () => eg, MobileNetV2Model: () => Jh, MobileNetV2PreTrainedModel: () => pr, MobileNetV3ForImageClassification: () => sg, MobileNetV3ForSemanticSegmentation: () => rg, MobileNetV3Model: () => tg, MobileNetV3PreTrainedModel: () => ur, MobileNetV4ForImageClassification: () => og, MobileNetV4ForSemanticSegmentation: () => ig, MobileNetV4Model: () => ng, MobileNetV4PreTrainedModel: () => _r, MobileViTForImageClassification: () => lg, MobileViTModel: () => ag, MobileViTPreTrainedModel: () => ko, MobileViTV2ForImageClassification: () => pg, MobileViTV2Model: () => cg, MobileViTV2PreTrainedModel: () => vo, ModernBertDecoderForCausalLM: () => hg, ModernBertDecoderModel: () => fg, ModernBertDecoderPreTrainedModel: () => Eo, ModernBertForMaskedLM: () => _g, ModernBertForSequenceClassification: () => dg, ModernBertForTokenClassification: () => mg, ModernBertModel: () => ug, ModernBertPreTrainedModel: () => bs, Moondream1ForConditionalGeneration: () => ff, MoonshineForConditionalGeneration: () => xg, MoonshineModel: () => gg, MoonshinePreTrainedModel: () => Ao, MptForCausalLM: () => Ag, MptModel: () => Eg, MptPreTrainedModel: () => Mo, MultiModalityCausalLM: () => Og, MultiModalityPreTrainedModel: () => Ul, MusicgenForCausalLM: () => zg, MusicgenForConditionalGeneration: () => Io, MusicgenModel: () => Ig, MusicgenPreTrainedModel: () => Oo, NanoChatForCausalLM: () => Cg, NanoChatModel: () => Tg, NanoChatPreTrainedModel: () => zo, NemotronHForCausalLM: () => Ng, NemotronHModel: () => Pg, NemotronHPreTrainedModel: () => To, NeoBertForMaskedLM: () => $g, NeoBertForQuestionAnswering: () => Dg, NeoBertForSequenceClassification: () => Fg, NeoBertForTokenClassification: () => Rg, NeoBertModel: () => Lg, NeoBertPreTrainedModel: () => Xt, NomicBertModel: () => qg, NomicBertPreTrainedModel: () => Gl, OPTForCausalLM: () => Jg, OPTModel: () => Yg, OPTPreTrainedModel: () => Fo, Olmo2ForCausalLM: () => Gg, Olmo2Model: () => Ug, Olmo2PreTrainedModel: () => Po, Olmo3ForCausalLM: () => Vg, Olmo3Model: () => Wg, Olmo3PreTrainedModel: () => No, OlmoForCausalLM: () => Bg, OlmoHybridForCausalLM: () => Kg, OlmoHybridModel: () => Hg, OlmoHybridPreTrainedModel: () => Lo, OlmoModel: () => jg, OlmoPreTrainedModel: () => Co, OpenELMForCausalLM: () => Qg, OpenELMModel: () => Xg, OpenELMPreTrainedModel: () => $o, OwlViTForObjectDetection: () => sx, OwlViTModel: () => tx, OwlViTPreTrainedModel: () => Do, Owlv2ForObjectDetection: () => ex, Owlv2Model: () => Zg, Owlv2PreTrainedModel: () => Ro, PaliGemmaForConditionalGeneration: () => rx, ParakeetForCTC: () => nx, ParakeetPreTrainedModel: () => Wl, PatchTSMixerForPrediction: () => ix, PatchTSMixerModel: () => ox, PatchTSMixerPreTrainedModel: () => qo, PatchTSTForPrediction: () => lx, PatchTSTModel: () => ax, PatchTSTPreTrainedModel: () => jo, Phi3ForCausalLM: () => _x, Phi3Model: () => ux, Phi3PreTrainedModel: () => Uo, Phi3VForCausalLM: () => Go, Phi3VPreTrainedModel: () => Vl, PhiForCausalLM: () => px, PhiModel: () => cx, PhiPreTrainedModel: () => Bo, PreTrainedModel: () => h, PvtForImageClassification: () => mx, PvtModel: () => dx, PvtPreTrainedModel: () => Wo, PyAnnoteForAudioFrameClassification: () => hx, PyAnnoteModel: () => fx, PyAnnotePreTrainedModel: () => Vo, Qwen2ForCausalLM: () => xx, Qwen2Model: () => gx, Qwen2MoeForCausalLM: () => yx, Qwen2MoeModel: () => wx, Qwen2MoePreTrainedModel: () => Ko, Qwen2PreTrainedModel: () => Ho, Qwen2VLForCausalLM: () => Vn, Qwen2VLForConditionalGeneration: () => ir, Qwen2VLPreTrainedModel: () => Cl, Qwen2_5_VLForCausalLM: () => Hn, Qwen2_5_VLForConditionalGeneration: () => gs, Qwen3ForCausalLM: () => kx, Qwen3Model: () => bx, Qwen3MoeForCausalLM: () => Ex, Qwen3MoeModel: () => vx, Qwen3MoePreTrainedModel: () => Qo, Qwen3NextForCausalLM: () => Mx, Qwen3NextModel: () => Ax, Qwen3NextPreTrainedModel: () => Yo, Qwen3PreTrainedModel: () => Xo, Qwen3VLForCausalLM: () => Jo, Qwen3VLForConditionalGeneration: () => ks, Qwen3VLMoeForCausalLM: () => Ox, Qwen3VLMoeForConditionalGeneration: () => Sx, Qwen3_5ForCausalLM: () => Zo, Qwen3_5ForConditionalGeneration: () => dr, Qwen3_5MoeForCausalLM: () => zx, Qwen3_5MoeForConditionalGeneration: () => Ix, RFDetrForObjectDetection: () => Nx, RFDetrModel: () => Px, RFDetrObjectDetectionOutput: () => Hl, RFDetrPreTrainedModel: () => ti, RTDetrForObjectDetection: () => em, RTDetrModel: () => Zd, RTDetrObjectDetectionOutput: () => wt, RTDetrPreTrainedModel: () => Sn, RTDetrV2ForObjectDetection: () => Vx, RTDetrV2Model: () => Wx, RTDetrV2ObjectDetectionOutput: () => Kl, RTDetrV2PreTrainedModel: () => si, ResNetForImageClassification: () => Cx, ResNetModel: () => Tx, ResNetPreTrainedModel: () => ei, RoFormerForMaskedLM: () => jx, RoFormerForQuestionAnswering: () => Gx, RoFormerForSequenceClassification: () => Bx, RoFormerForTokenClassification: () => Ux, RoFormerModel: () => qx, RoFormerPreTrainedModel: () => Yt, RobertaForMaskedLM: () => $x, RobertaForQuestionAnswering: () => Dx, RobertaForSequenceClassification: () => Fx, RobertaForTokenClassification: () => Rx, RobertaModel: () => Lx, RobertaPreTrainedModel: () => Qt, Sam2ImageSegmentationOutput: () => Yl, Sam2Model: () => ri, Sam2PreTrainedModel: () => Jl, Sam3TrackerModel: () => Xx, SamImageSegmentationOutput: () => Xl, SamModel: () => Hx, SamPreTrainedModel: () => Ql, SapiensForDepthEstimation: () => Yx, SapiensForNormalEstimation: () => Jx, SapiensForSemanticSegmentation: () => Qx, SapiensPreTrainedModel: () => mr, SegformerForImageClassification: () => ew, SegformerForSemanticSegmentation: () => tw, SegformerModel: () => Zx, SegformerPreTrainedModel: () => fr, SiglipModel: () => sw, SiglipPreTrainedModel: () => ni, SiglipTextModel: () => oi, SiglipVisionModel: () => rw, SmolLM3ForCausalLM: () => ow, SmolLM3Model: () => nw, SmolLM3PreTrainedModel: () => ii, SnacDecoderModel: () => li, SnacEncoderModel: () => ai, SnacModel: () => iw, SnacPreTrainedModel: () => hr, SolarOpenForCausalLM: () => lw, SolarOpenModel: () => aw, SolarOpenPreTrainedModel: () => ci, SpeechT5ForSpeechToText: () => pw, SpeechT5ForTextToSpeech: () => uw, SpeechT5HifiGan: () => _w, SpeechT5Model: () => cw, SpeechT5PreTrainedModel: () => gr, SqueezeBertForMaskedLM: () => mw, SqueezeBertForQuestionAnswering: () => hw, SqueezeBertForSequenceClassification: () => fw, SqueezeBertModel: () => dw, SqueezeBertPreTrainedModel: () => vs, StableLmForCausalLM: () => xw, StableLmModel: () => gw, StableLmPreTrainedModel: () => pi, Starcoder2ForCausalLM: () => yw, Starcoder2Model: () => ww, Starcoder2PreTrainedModel: () => ui, StyleTextToSpeech2Model: () => bw, StyleTextToSpeech2PreTrainedModel: () => Zl, SupertonicForConditionalGeneration: () => _i, SupertonicPreTrainedModel: () => ec, Swin2SRForImageSuperResolution: () => Mw, Swin2SRModel: () => Aw, Swin2SRPreTrainedModel: () => di, SwinForImageClassification: () => vw, SwinForSemanticSegmentation: () => Ew, SwinModel: () => kw, SwinPreTrainedModel: () => xr, T5ForConditionalGeneration: () => Ow, T5Model: () => Sw, T5PreTrainedModel: () => mi, TableTransformerForObjectDetection: () => zw, TableTransformerModel: () => Iw, TableTransformerObjectDetectionOutput: () => tc, TableTransformerPreTrainedModel: () => fi, TrOCRForCausalLM: () => Tw, TrOCRPreTrainedModel: () => sc, UltravoxModel: () => xs, UltravoxPreTrainedModel: () => Pl, UniSpeechForCTC: () => Pw, UniSpeechForSequenceClassification: () => Nw, UniSpeechModel: () => Cw, UniSpeechPreTrainedModel: () => wr, UniSpeechSatForAudioFrameClassification: () => Rw, UniSpeechSatForCTC: () => $w, UniSpeechSatForSequenceClassification: () => Fw, UniSpeechSatModel: () => Lw, UniSpeechSatPreTrainedModel: () => Es, VaultGemmaForCausalLM: () => qw, VaultGemmaModel: () => Dw, VaultGemmaPreTrainedModel: () => hi, ViTForImageClassification: () => Uw, ViTMAEModel: () => Gw, ViTMAEPreTrainedModel: () => rc, ViTMSNForImageClassification: () => Vw, ViTMSNModel: () => Ww, ViTMSNPreTrainedModel: () => xi, ViTModel: () => Bw, ViTPreTrainedModel: () => gi, VisionEncoderDecoderModel: () => jw, VitMatteForImageMatting: () => Hw, VitMattePreTrainedModel: () => nc, VitPoseForPoseEstimation: () => Kw, VitPosePreTrainedModel: () => oc, VitsModel: () => Xw, VitsModelOutput: () => ic, VitsPreTrainedModel: () => ac, VoxtralForConditionalGeneration: () => Qw, VoxtralRealtimeForConditionalGeneration: () => wi, VoxtralRealtimePreTrainedModel: () => lc, Wav2Vec2BertForCTC: () => ey, Wav2Vec2BertForSequenceClassification: () => ty, Wav2Vec2BertModel: () => Zw, Wav2Vec2BertPreTrainedModel: () => yr, Wav2Vec2ForAudioFrameClassification: () => eh, Wav2Vec2ForCTC: () => Jf, Wav2Vec2ForSequenceClassification: () => Zf, Wav2Vec2Model: () => Yf, Wav2Vec2PreTrainedModel: () => pt, WavLMForAudioFrameClassification: () => iy, WavLMForCTC: () => ry, WavLMForSequenceClassification: () => ny, WavLMForXVector: () => oy, WavLMModel: () => sy, WavLMPreTrainedModel: () => Jt, WeSpeakerResNetModel: () => ay, WeSpeakerResNetPreTrainedModel: () => pc, WhisperForConditionalGeneration: () => _c, WhisperModel: () => ly, WhisperPreTrainedModel: () => yi, XLMForQuestionAnswering: () => my, XLMForSequenceClassification: () => _y, XLMForTokenClassification: () => dy, XLMModel: () => py, XLMPreTrainedModel: () => Zt, XLMRobertaForMaskedLM: () => hy, XLMRobertaForQuestionAnswering: () => wy, XLMRobertaForSequenceClassification: () => gy, XLMRobertaForTokenClassification: () => xy, XLMRobertaModel: () => fy, XLMRobertaPreTrainedModel: () => es, XLMWithLMHeadModel: () => uy, XVectorOutput: () => cc, YolosForObjectDetection: () => by, YolosModel: () => yy, YolosObjectDetectionOutput: () => dc, YolosPreTrainedModel: () => bi, YoutuForCausalLM: () => vy, YoutuModel: () => ky, YoutuPreTrainedModel: () => ki });
  var ms = class extends h {
  };
  var K_ = class extends ms {
  };
  var X_ = class extends ms {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Q_ = class extends ms {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Y_ = class extends ms {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var ln = class extends h {
  };
  var J_ = class extends ln {
  };
  var Z_ = class extends ln {
  };
  var cn = class extends h {
  };
  var ed = class extends cn {
  };
  var td = class extends cn {
  };
  var pn = class extends h {
  };
  var sd = class extends pn {
  };
  var rd = class extends pn {
  };
  var un = class extends h {
  };
  var nd = class extends un {
  };
  var od = class extends un {
  };
  var er = class extends h {
  };
  var id = class extends er {
  };
  var ad = class extends er {
  };
  var ld = class extends er {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var _n = class extends h {
  };
  var cd = class extends _n {
  };
  var pd = class extends _n {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var qt = class extends h {
  };
  var ud = class extends qt {
  };
  var _d = class extends qt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var dd = class extends qt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var md = class extends qt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var fd = class extends qt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var dn = class extends h {
  };
  var hd = class extends dn {
  };
  var gd = class extends dn {
  };
  var mn = class extends h {
  };
  var xd = class extends mn {
  };
  var wd = class extends mn {
  };
  var fn = class extends h {
  };
  var yd = class extends fn {
  };
  var bd = class extends fn {
  };
  var jt = class extends h {
  };
  var kd = class extends jt {
  };
  var vd = class extends jt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Ed = class extends jt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Ad = class extends jt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Md = class extends jt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var aM = 4299n;
  var Ob = 6561n;
  var fl = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "inputs_embeds", "attention_mask", "position_ids", "audio_values", "exaggeration", "audio_features", "audio_tokens", "speaker_embeddings", "speaker_features", "past_key_values"]);
      __publicField(this, "main_input_name", "input_ids");
      __publicField(this, "_return_dict_in_generate_keys", ["audio_tokens", "speaker_embeddings", "speaker_features"]);
    }
  };
  var hn = class extends fl {
    async encode_speech(e) {
      return X(this.sessions.speech_encoder, { audio_values: e });
    }
    async forward({ input_ids: e = null, attention_mask: s = null, audio_values: r = null, exaggeration: n = null, position_ids: o = null, inputs_embeds: i = null, past_key_values: a = null, generation_config: l = null, logits_processor: c = null, audio_features: p = null, audio_tokens: u = null, speaker_embeddings: _ = null, speaker_features: d = null, ...m }) {
      let f;
      if (!i) {
        let x = this.sessions.embed_tokens.inputNames, w = { input_ids: e };
        if (x.includes("exaggeration")) {
          if (!(n instanceof E)) {
            let y = e.dims[0];
            if (n == null) n = ke([y], 0.5);
            else if (typeof n == "number") n = ke([y], n);
            else if (Array.isArray(n)) n = new E("float32", n, [y]);
            else throw new Error("Unsupported type for `exaggeration` input");
          }
          w.exaggeration = n;
        }
        if (x.includes("position_ids") && (w.position_ids = o), { inputs_embeds: i } = await X(this.sessions.embed_tokens, w), p && u && _ && d && (f = { audio_features: p, audio_tokens: u, speaker_embeddings: _, speaker_features: d }), f || r) f ?? (f = await this.encode_speech(r)), i = ie([f.audio_features, i], 1), s = Me([i.dims[0], i.dims[1]]);
        else {
          let y = i.dims[1];
          if (!a || y !== 1) throw new Error("Incorrect state encountered during generation.");
          let b = a.get_seq_length();
          s = Me([i.dims[0], b + y]);
        }
      }
      return { ...await Ve(this, { inputs_embeds: i, past_key_values: a, attention_mask: s, generation_config: l, logits_processor: c }, false), ...f };
    }
    prepare_inputs_for_generation(e, s, r) {
      if (!s.position_ids && this.sessions.embed_tokens.inputNames.includes("position_ids")) if (s.input_ids.dims[1] === 1) {
        let n = Array.from({ length: e.length }, (o, i) => e[i].length - e[i].findLastIndex((a) => a == Ob) - 1);
        s.position_ids = new E("int64", n, [e.length, 1]);
      } else {
        let o = s.input_ids.tolist().map((i) => {
          let a = 0;
          return i.map((l) => l >= Ob ? 0 : a++);
        });
        s.position_ids = new E("int64", o.flat(), s.input_ids.dims);
      }
      return s.input_ids.dims[1] === 1 && (delete s.audio_values, delete s.audio_features, delete s.audio_tokens, delete s.speaker_embeddings, delete s.speaker_features), Js(this, e, s, r);
    }
    async generate(e) {
      let { sequences: s, audio_tokens: r, speaker_embeddings: n, speaker_features: o } = await super.generate({ ...e, return_dict_in_generate: true }), i = s.slice(null, [e.input_ids.dims[1], -1]), a = ke([i.dims[0], 3], aM), l = ie([r, i, a], 1), { waveform: c } = await X(this.sessions.conditional_decoder, { speech_tokens: l, speaker_features: o, speaker_embeddings: n });
      return c;
    }
  };
  var hl = class extends h {
  };
  var Sd = class extends hl {
  };
  var gl = class extends h {
  };
  var Od = class extends gl {
  };
  var tr = class extends h {
  };
  var Id = class extends tr {
  };
  var gn = class extends tr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "text_model" });
    }
  };
  var xn = class extends tr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "audio_model" });
    }
  };
  var xt = class extends h {
  };
  var zd = class extends xt {
  };
  var Td = class extends xt {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "text_model" });
    }
  };
  var wn = class extends xt {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "text_model" });
    }
  };
  var Cd = class extends xt {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "vision_model" });
    }
  };
  var Pd = class extends xt {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "vision_model" });
    }
  };
  var yn = class extends h {
  };
  var Nd = class extends yn {
  };
  var Ld = class extends yn {
  };
  var bn = class extends h {
  };
  var $d = class extends bn {
  };
  var Fd = class extends bn {
  };
  var kn = class extends h {
  };
  var Rd = class extends kn {
  };
  var Dd = class extends kn {
  };
  var vn = class extends h {
  };
  var qd = class extends vn {
  };
  var jd = class extends vn {
  };
  var En = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "requires_attention_mask", false);
      __publicField(this, "main_input_name", "input_features");
      __publicField(this, "forward_params", ["input_features", "decoder_input_ids", "decoder_attention_mask", "past_key_values"]);
    }
  };
  var Bd = class extends En {
  };
  var Ud = class extends En {
  };
  var Bt = class extends h {
  };
  var Gd = class extends Bt {
  };
  var Wd = class extends Bt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Vd = class extends Bt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Hd = class extends Bt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Kd = class extends Bt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var An = class extends h {
  };
  var Xd = class extends An {
  };
  var Qd = class extends An {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Mn = class extends h {
  };
  var Yd = class extends Mn {
  };
  var Jd = class extends Mn {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Sn = class extends h {
  };
  var Zd = class extends Sn {
  };
  var em = class extends Sn {
    async _call(e) {
      return new wt(await super._call(e));
    }
  };
  var wt = class extends he {
    constructor({ logits: e, pred_boxes: s }) {
      super(), this.logits = e, this.pred_boxes = s;
    }
  };
  var On = class extends h {
  };
  var tm = class extends On {
  };
  var sm = class extends On {
    async _call(e) {
      return new wt(await super._call(e));
    }
  };
  var xl = class extends he {
    constructor({ audio_codes: e }) {
      super(), this.audio_codes = e;
    }
  };
  var wl = class extends he {
    constructor({ audio_values: e }) {
      super(), this.audio_values = e;
    }
  };
  var sr = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "main_input_name", "input_values");
      __publicField(this, "forward_params", ["input_values"]);
    }
  };
  var rm = class extends sr {
    async encode(e) {
      return new xl(await X(this.sessions.encoder_model, e));
    }
    async decode(e) {
      return new wl(await X(this.sessions.decoder_model, e));
    }
  };
  var In = class extends sr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "encoder_model" });
    }
  };
  var zn = class extends sr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "decoder_model" });
    }
  };
  var Ut = class extends h {
  };
  var nm = class extends Ut {
  };
  var om = class extends Ut {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var im = class extends Ut {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var am = class extends Ut {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var lm = class extends Ut {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Tn = class extends h {
  };
  var cm = class extends Tn {
  };
  var pm = class extends Tn {
  };
  var Gt = class extends h {
  };
  var um = class extends Gt {
  };
  var _m = class extends Gt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var dm = class extends Gt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var mm = class extends Gt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var fm = class extends Gt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var yl = class extends h {
  };
  var hm = class extends yl {
  };
  var Cn = class extends h {
  };
  var gm = class extends Cn {
  };
  var xm = class extends Cn {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var bl = class extends h {
  };
  var wm = class extends bl {
  };
  var kl = class extends h {
  };
  var ym = class extends kl {
  };
  var rr = class extends h {
  };
  var bm = class extends rr {
  };
  var km = class extends rr {
    async _call(e) {
      return new nr(await super._call(e));
    }
  };
  var vm = class extends rr {
    async _call(e) {
      return new vl(await super._call(e));
    }
  };
  var nr = class extends he {
    constructor({ logits: e, pred_boxes: s }) {
      super(), this.logits = e, this.pred_boxes = s;
    }
  };
  var vl = class extends he {
    constructor({ logits: e, pred_boxes: s, pred_masks: r }) {
      super(), this.logits = e, this.pred_boxes = s, this.pred_masks = r;
    }
  };
  var Pn = class extends h {
  };
  var Em = class extends Pn {
  };
  var Am = class extends Pn {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Nn = class extends h {
  };
  var Mm = class extends Nn {
  };
  var Sm = class extends Nn {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var El = class extends h {
  };
  var Om = class extends El {
  };
  var Al = class extends h {
  };
  var Im = class extends Al {
  };
  var Wt = class extends h {
  };
  var zm = class extends Wt {
  };
  var Tm = class extends Wt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Cm = class extends Wt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Pm = class extends Wt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Nm = class extends Wt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Ml = class extends h {
  };
  var Lm = class extends Ml {
  };
  var Ln = class extends h {
  };
  var $m = class extends Ln {
  };
  var Fm = class extends Ln {
  };
  var $n = class extends h {
  };
  var Rm = class extends $n {
  };
  var Dm = class extends $n {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Vt = class extends h {
  };
  var qm = class extends Vt {
  };
  var jm = class extends Vt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Bm = class extends Vt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Um = class extends Vt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Gm = class extends Vt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Fn = class extends h {
  };
  var Wm = class extends Fn {
  };
  var Vm = class extends Fn {
  };
  var fs = class extends h {
  };
  var Hm = class extends fs {
  };
  var Km = class extends fs {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Xm = class extends fs {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Qm = class extends fs {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var hs = class extends h {
  };
  var Ym = class extends hs {
  };
  var Jm = class extends hs {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Zm = class extends hs {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var ef = class extends hs {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Rn = class extends h {
  };
  var tf = class extends Rn {
  };
  var sf = class extends Rn {
  };
  var Dn = class extends h {
  };
  var rf = class extends Dn {
  };
  var nf = class extends Dn {
  };
  var qn = class extends h {
  };
  var of = class extends qn {
  };
  var af = class extends qn {
  };
  var jn = class extends h {
  };
  var lf = class extends jn {
  };
  var cf = class extends jn {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Sl = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "inputs_embeds", "attention_mask", "pixel_values", "encoder_outputs", "decoder_input_ids", "decoder_inputs_embeds", "decoder_attention_mask", "past_key_values"]);
      __publicField(this, "main_input_name", "inputs_embeds");
    }
  };
  var pf = class extends Sl {
    _merge_input_ids_with_image_features({ inputs_embeds: e, image_features: s, input_ids: r, attention_mask: n }) {
      return { inputs_embeds: ie([s, e], 1), attention_mask: ie([Me(s.dims.slice(0, 2)), n], 1) };
    }
    async _prepare_inputs_embeds({ input_ids: e, pixel_values: s, inputs_embeds: r, attention_mask: n }) {
      if (!e && !s) throw new Error("Either `input_ids` or `pixel_values` should be provided.");
      let o, i;
      return e && (o = await this.encode_text({ input_ids: e })), s && (i = await this.encode_image({ pixel_values: s })), o && i ? { inputs_embeds: r, attention_mask: n } = this._merge_input_ids_with_image_features({ inputs_embeds: o, image_features: i, input_ids: e, attention_mask: n }) : r = o || i, { inputs_embeds: r, attention_mask: n };
    }
    async forward({ input_ids: e, pixel_values: s, attention_mask: r, decoder_input_ids: n, decoder_attention_mask: o, encoder_outputs: i, past_key_values: a, inputs_embeds: l, decoder_inputs_embeds: c }) {
      if (l || ({ inputs_embeds: l, attention_mask: r } = await this._prepare_inputs_embeds({ input_ids: e, pixel_values: s, inputs_embeds: l, attention_mask: r })), !i) {
        let { last_hidden_state: u } = await st(this, { inputs_embeds: l, attention_mask: r });
        i = u;
      }
      if (!c) {
        if (!n) throw new Error("Either `decoder_input_ids` or `decoder_inputs_embeds` should be provided.");
        c = await this.encode_text({ input_ids: n });
      }
      return await Ve(this, { inputs_embeds: c, attention_mask: o, encoder_attention_mask: r, encoder_hidden_states: i, past_key_values: a }, true);
    }
  };
  var Bn = class extends h {
  };
  var uf = class extends Bn {
  };
  var _f = class extends Bn {
  };
  var Un = class extends h {
  };
  var df = class extends Un {
  };
  var mf = class extends Un {
  };
  var Ol = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "pixel_values", "position_ids", "past_key_values"]);
    }
  };
  var Ue = class extends Ol {
    _merge_input_ids_with_image_features(e) {
      let s = e.image_features.dims.at(-1), r = e.image_features.view(-1, s);
      return Zs({ image_token_id: this.config.image_token_index ?? this.config.image_token_id, ...e, image_features: r });
    }
  };
  var ff = class extends Ue {
  };
  var hf = class extends Ue {
  };
  var Il = class extends h {
  };
  var gf = class extends Il {
  };
  var zl = class extends Ue {
  };
  var xf = class extends zl {
  };
  var Tl = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "inputs_embeds", "per_layer_inputs", "position_ids", "pixel_values", "input_features", "input_features_mask", "past_key_values"]);
    }
  };
  var Ht = class extends Tl {
    async forward({ input_ids: e = null, attention_mask: s = null, pixel_values: r = null, input_features: n = null, input_features_mask: o = null, position_ids: i = null, inputs_embeds: a = null, per_layer_inputs: l = null, past_key_values: c = null, generation_config: p = null, logits_processor: u = null, ..._ }) {
      if ((!a || !l) && ({ inputs_embeds: a, per_layer_inputs: l } = await X(this.sessions.embed_tokens, { input_ids: e }), e.dims[1] !== 1)) {
        if (r) {
          let { image_features: m } = await this._encode_vision({ pixel_values: r, ..._ });
          ({ inputs_embeds: a, attention_mask: s } = this._merge_input_ids_with_image_features({ image_features: m, inputs_embeds: a, input_ids: e, attention_mask: s }));
        }
        if (n) {
          let { audio_features: m } = await X(this.sessions.audio_encoder, { input_features: n, input_features_mask: o });
          ({ inputs_embeds: a, attention_mask: s } = this._merge_input_ids_with_audio_features({ audio_features: m, inputs_embeds: a, input_ids: e, attention_mask: s }));
        }
      }
      return await Ve(this, { inputs_embeds: a, per_layer_inputs: l, past_key_values: c, attention_mask: s, position_ids: i, generation_config: p, logits_processor: u }, true);
    }
    _encode_vision(e) {
      return X(this.sessions.vision_encoder, { pixel_values: e.pixel_values });
    }
    _merge_input_ids_with_image_features(e) {
      let s = e.image_features.dims.at(-1), r = e.image_features.view(-1, s);
      return Zs({ image_token_id: this.config.image_token_id, ...e, image_features: r });
    }
    _merge_input_ids_with_audio_features(e) {
      let s = e.audio_features.dims.at(-1), r = e.audio_features.view(-1, s);
      return ml({ audio_token_id: this.config.audio_token_id, ...e, audio_features: r });
    }
  };
  var wf = class extends Ht {
  };
  var or = class extends Ht {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "inputs_embeds", "per_layer_inputs", "position_ids", "pixel_values", "image_position_ids", "input_features", "input_features_mask", "past_key_values"]);
    }
    _encode_vision(e) {
      return X(this.sessions.vision_encoder, { pixel_values: e.pixel_values, pixel_position_ids: e.image_position_ids });
    }
  };
  var yf = class extends or {
  };
  var Gn = class extends h {
  };
  var bf = class extends Gn {
  };
  var kf = class extends Gn {
  };
  var Wn = class extends h {
  };
  var vf = class extends Wn {
  };
  var Ef = class extends Wn {
  };
  var Cl = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "position_ids", "past_key_values", "pixel_values", "image_grid_thw"]);
    }
  };
  var ir = class extends Cl {
    constructor() {
      super(...arguments);
      __publicField(this, "image_grid_thw_name", "grid_thw");
    }
    _get_text_only_rope_index(e, s) {
      if (s) {
        let { data: r, dims: n } = H_(s), o = BigInt64Array.from({ length: 3 * r.length }, (a, l) => r[l % r.length]), i = Array.from({ length: n[0] }, (a, l) => de(r.subarray(n[1] * l, n[1] * (l + 1)))[0] + 1n + BigInt(n[1]));
        return [new E("int64", o, [3, ...n]), new E("int64", i, [i.length, 1])];
      } else {
        let [r, n] = e.dims, o = BigInt64Array.from({ length: 3 * r * n }, (i, a) => BigInt(Math.floor(a % n / r)));
        return [new E("int64", o, [3, ...e.dims]), ip([r, 1])];
      }
    }
    _reorder_and_write_positions(e, s, r, n) {
      let o = e.reduce((c, p) => c + p.length, 0), i = new Array(o), a = 0;
      for (let c = 0; c < 3; ++c) for (let p of e) {
        let u = p.length / 3;
        for (let _ = c * u; _ < (c + 1) * u; ++_) i[a++] = p[_];
      }
      let l = 0;
      for (let c = 0; c < s.length; ++c) if (s[c] == 1) {
        for (let p = 0; p < 3; ++p) r[p][n][c] = i[p * o / 3 + l];
        ++l;
      }
      return i;
    }
    _get_multimodal_rope_positions({ filtered_ids: e, image_grid_thw_list: s, video_grid_thw_list: r, spatial_merge_size: n, state: o }) {
      let { image_token_id: i, video_token_id: a, vision_start_token_id: l } = this.config, c = e, u = c.reduce((w, y, b) => (y == l && w.push(b), w), []).map((w) => c[w + 1]), _ = u.filter((w) => w == i).length, d = u.filter((w) => w == a).length, m = [], f = 0, g = _, x = d;
      for (let w = 0; w < u.length; ++w) {
        let y = c.findIndex((G, ee) => ee > f && G == i), b = c.findIndex((G, ee) => ee > f && G == a), v = g > 0 && y !== -1 ? y : c.length + 1, k = x > 0 && b !== -1 ? b : c.length + 1, S, I, $, C;
        v < k ? ([I, $, C] = s[o.image_index], ++o.image_index, --g, S = v) : ([I, $, C] = r[o.video_index], ++o.video_index, --x, S = k);
        let [q, D, B] = [Number(I), Math.floor(Number($) / n), Math.floor(Number(C) / n)], H = S - f, V = m.length > 0 ? de(m.at(-1))[0] + 1 : 0;
        m.push(Array.from({ length: 3 * H }, (G, ee) => V + ee % H));
        let Z = H + V, R = q * D * B, A = Array.from({ length: R }, (G, ee) => Z + Math.floor(ee / (D * B))), O = Array.from({ length: R }, (G, ee) => Z + Math.floor(ee / B) % D), z = Array.from({ length: R }, (G, ee) => Z + ee % B);
        m.push([A, O, z].flat()), f = S + R;
      }
      if (f < c.length) {
        let w = m.length > 0 ? de(m.at(-1))[0] + 1 : 0, y = c.length - f;
        m.push(Array.from({ length: 3 * y }, (b, v) => w + v % y));
      }
      return m;
    }
    get_rope_index(e, s, r, n) {
      let { vision_config: o } = this.config, i = o.spatial_merge_size ?? 2;
      if (s || r) {
        let a = e.tolist();
        n || (n = ba(e));
        let l = n.tolist(), c = Array.from({ length: 3 }, () => Array.from({ length: e.dims[0] }, () => Array.from({ length: e.dims[1] }, () => 0))), p = s ? s.tolist() : [], u = r ? r.tolist() : [], _ = { image_index: 0, video_index: 0 }, d = [];
        for (let m = 0; m < a.length; ++m) {
          let f = a[m].filter((w, y) => l[m][y] == 1), g = this._get_multimodal_rope_positions({ filtered_ids: f, image_grid_thw_list: p, video_grid_thw_list: u, spatial_merge_size: i, state: _ }), x = this._reorder_and_write_positions(g, l[m], c, m);
          d.push(de(x)[0] + 1 - a[m].length);
        }
        return [new E("int64", c.flat(1 / 0), [3, e.dims[0], e.dims[1]]), new E("int64", d, [d.length, 1])];
      } else return this._get_text_only_rope_index(e, n);
    }
    async encode_image({ pixel_values: e, image_grid_thw: s }) {
      return (await X(this.sessions.vision_encoder, { pixel_values: e, [this.image_grid_thw_name]: s })).image_features;
    }
    _merge_input_ids_with_image_features(e) {
      return Zs({ image_token_id: this.config.image_token_id, ...e });
    }
    prepare_inputs_for_generation(e, s, r) {
      if (!s.attention_mask || s.position_ids || !(this.sessions.decoder_model_merged ?? this.sessions.model).inputNames.includes("position_ids")) return s;
      if (!s.past_key_values) [s.position_ids, s.rope_deltas] = this.get_rope_index(s.input_ids, s.image_grid_thw, s.video_grid_thw, s.attention_mask);
      else {
        s.pixel_values = null;
        let o = s.past_key_values.get_seq_length();
        if (o < s.input_ids.dims[1]) {
          let [i, a] = this.get_rope_index(s.input_ids, s.image_grid_thw, s.video_grid_thw, s.attention_mask);
          s.rope_deltas = a, s.position_ids = i.slice(null, null, [o, null]), s.input_ids = s.input_ids.slice(null, [o, null]);
        } else {
          s.rope_deltas || ([, s.rope_deltas] = this.get_rope_index(s.input_ids, s.image_grid_thw, s.video_grid_thw, s.attention_mask));
          let i = BigInt(o), a = s.rope_deltas.map((l) => i + l);
          s.position_ids = qe([a, a, a], 0);
        }
      }
      return s;
    }
  };
  var Vn = class extends ir {
  };
  var gs = class extends ir {
    constructor() {
      super(...arguments);
      __publicField(this, "image_grid_thw_name", "image_grid_thw");
    }
  };
  var Hn = class extends Vn {
    constructor() {
      super(...arguments);
      __publicField(this, "image_grid_thw_name", "image_grid_thw");
    }
  };
  var Af = class extends gs {
    get_vision_position_ids(e, s, r, n) {
      let o = Math.floor(s[0] / r), i = Math.floor(s[1] / n), a = Math.floor(s[2] / n), l = i * a * o, c = Array.from({ length: l }, () => e), p = Array.from({ length: l }, (_, d) => e + Math.floor(d / (a * o))), u = Array.from({ length: l }, (_, d) => e + d % a);
      return [...c, ...p, ...u];
    }
    _get_multimodal_rope_positions({ filtered_ids: e, image_grid_thw_list: s, video_grid_thw_list: r, spatial_merge_size: n, state: o }) {
      let { image_token_id: i } = this.config, a = [], l = 0, c = e[0] == i ? 1 : 0;
      for (let _ = 1; _ <= e.length; ++_) {
        let d = _ < e.length ? e[_] == i ? 1 : 0 : -1;
        d !== c && (a.push([c, l, _]), l = _, c = d);
      }
      let p = 0, u = [];
      for (let [_, d, m] of a) if (_ === 0) {
        let f = m - d;
        u.push(Array.from({ length: 3 * f }, (g, x) => p + x % f)), p += f;
      } else {
        let f = s[o.image_index++].map(Number), g = f[0];
        u.push(this.get_vision_position_ids(p, f, g, n)), p += Math.max(f[1], f[2]) / n;
      }
      return u;
    }
  };
  var Kn = class extends h {
  };
  var Mf = class extends Kn {
  };
  var Sf = class extends Kn {
  };
  var Xn = class extends h {
  };
  var Of = class extends Xn {
  };
  var If = class extends Xn {
  };
  var Qn = class extends h {
  };
  var zf = class extends Qn {
  };
  var Tf = class extends Qn {
  };
  var Yn = class extends h {
  };
  var Cf = class extends Yn {
  };
  var Pf = class extends Yn {
  };
  var Jn = class extends h {
  };
  var Nf = class extends Jn {
  };
  var Lf = class extends Jn {
  };
  var Zn = class extends h {
  };
  var $f = class extends Zn {
  };
  var Ff = class extends Zn {
  };
  var eo = class extends h {
  };
  var Rf = class extends eo {
  };
  var Df = class extends eo {
  };
  var to = class extends h {
  };
  var qf = class extends to {
  };
  var jf = class extends to {
  };
  var so = class extends h {
  };
  var Bf = class extends so {
  };
  var Uf = class extends so {
  };
  var Pl = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "position_ids", "audio_values", "past_key_values"]);
    }
  };
  var xs = class extends Pl {
    _merge_input_ids_with_audio_features(e) {
      let s = e.audio_features.dims.at(-1), r = e.audio_features.view(-1, s);
      return ml({ audio_token_id: this.config.ignore_index ?? this.config.audio_token_id ?? this.config.audio_token_index, ...e, audio_features: r });
    }
  };
  var Gf = class extends xs {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "input_features", "past_key_values"]);
    }
  };
  var Nl = class extends h {
  };
  var Wf = class extends Nl {
  };
  var Ll = class extends h {
  };
  var Vf = class extends Ll {
  };
  var ro = class extends h {
  };
  var Hf = class extends ro {
  };
  var Kf = class extends ro {
  };
  var no = class extends h {
  };
  var Xf = class extends no {
  };
  var Qf = class extends no {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var pt = class extends h {
  };
  var Yf = class extends pt {
  };
  var Jf = class extends pt {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var Zf = class extends pt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var eh = class extends pt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var th = class extends h {
  };
  var sh = class extends pt {
  };
  var rh = class extends pt {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var nh = class extends pt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var oo = class extends h {
  };
  var oh = class extends oo {
  };
  var ih = class extends oo {
  };
  var ah = class extends Ue {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "pixel_values", "pixel_attention_mask", "position_ids", "past_key_values"]);
    }
  };
  var io = class extends h {
  };
  var lh = class extends io {
  };
  var ch = class extends io {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var ao = class extends h {
  };
  var ph = class extends ao {
  };
  var uh = class extends ao {
  };
  var ar = class extends h {
  };
  var _h = class extends ar {
    async forward(e) {
      let s = !e.input_ids, r = !e.pixel_values;
      if (s && r) throw new Error("Either `input_ids` or `pixel_values` should be provided.");
      if (s && (e.input_ids = Me([e.pixel_values.dims[0], 1])), r) {
        let { image_size: c } = this.config.vision_config;
        e.pixel_values = ke([0, 3, c, c], 0);
      }
      let { text_embeddings: n, image_embeddings: o, l2norm_text_embeddings: i, l2norm_image_embeddings: a } = await super.forward(e), l = {};
      return s || (l.text_embeddings = n, l.l2norm_text_embeddings = i), r || (l.image_embeddings = o, l.l2norm_image_embeddings = a), l;
    }
  };
  var lo = class extends ar {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "text_model" });
    }
  };
  var dh = class extends ar {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "vision_model" });
    }
  };
  var co = class extends h {
  };
  var mh = class extends co {
  };
  var fh = class extends co {
  };
  var hh = class extends Ue {
  };
  var po = class extends h {
  };
  var gh = class extends po {
  };
  var xh = class extends po {
  };
  var wh = class extends Ue {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "pixel_values", "pixel_attention_mask", "spatial_shapes", "position_ids", "past_key_values"]);
    }
  };
  var uo = class extends h {
  };
  var yh = class extends uo {
  };
  var bh = class extends uo {
  };
  var $l = class extends h {
  };
  var kh = class extends $l {
  };
  var _o = class extends h {
  };
  var vh = class extends _o {
  };
  var Eh = class extends _o {
  };
  var mo = class extends h {
  };
  var Ah = class extends mo {
  };
  var Mh = class extends mo {
  };
  var fo = class extends h {
  };
  var Sh = class extends fo {
  };
  var Oh = class extends fo {
  };
  var ho = class extends h {
  };
  var Ih = class extends ho {
  };
  var zh = class extends ho {
  };
  var ws = class extends h {
  };
  var Th = class extends ws {
  };
  var Ch = class extends ws {
  };
  var Ph = class extends ws {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Nh = class extends ws {
  };
  var Fl = class extends h {
  };
  var Lh = class extends Fl {
  };
  var Rl = class extends h {
  };
  var $h = class extends Rl {
  };
  var Dl = class extends he {
    constructor({ char_logits: e, bpe_logits: s, wp_logits: r }) {
      super(), this.char_logits = e, this.bpe_logits = s, this.wp_logits = r;
    }
    get logits() {
      return [this.char_logits, this.bpe_logits, this.wp_logits];
    }
  };
  var ql = class extends h {
  };
  var Fh = class extends ql {
    async _call(e) {
      return new Dl(await super._call(e));
    }
  };
  var jl = class extends he {
    constructor({ audio_codes: e }) {
      super(), this.audio_codes = e;
    }
  };
  var Bl = class extends he {
    constructor({ audio_values: e }) {
      super(), this.audio_values = e;
    }
  };
  var lr = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "main_input_name", "input_values");
      __publicField(this, "forward_params", ["input_values"]);
    }
  };
  var Rh = class extends lr {
    async encode(e) {
      return new jl(await X(this.sessions.encoder_model, e));
    }
    async decode(e) {
      return new Bl(await X(this.sessions.decoder_model, e));
    }
  };
  var go = class extends lr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "encoder_model" });
    }
  };
  var xo = class extends lr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "decoder_model" });
    }
  };
  var wo = class extends h {
  };
  var Dh = class extends wo {
  };
  var qh = class extends wo {
  };
  var yo = class extends h {
  };
  var jh = class extends yo {
  };
  var Bh = class extends yo {
  };
  var ys = class extends h {
  };
  var Uh = class extends ys {
  };
  var Gh = class extends ys {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Wh = class extends ys {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Vh = class extends ys {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var bo = class extends h {
  };
  var Hh = class extends bo {
  };
  var Kh = class extends bo {
  };
  var cr = class extends h {
  };
  var Xh = class extends cr {
  };
  var Qh = class extends cr {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Yh = class extends cr {
  };
  var pr = class extends h {
  };
  var Jh = class extends pr {
  };
  var Zh = class extends pr {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var eg = class extends pr {
  };
  var ur = class extends h {
  };
  var tg = class extends ur {
  };
  var sg = class extends ur {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var rg = class extends ur {
  };
  var _r = class extends h {
  };
  var ng = class extends _r {
  };
  var og = class extends _r {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var ig = class extends _r {
  };
  var ko = class extends h {
  };
  var ag = class extends ko {
  };
  var lg = class extends ko {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var vo = class extends h {
  };
  var cg = class extends vo {
  };
  var pg = class extends vo {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var bs = class extends h {
  };
  var ug = class extends bs {
  };
  var _g = class extends bs {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var dg = class extends bs {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var mg = class extends bs {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Eo = class extends h {
  };
  var fg = class extends Eo {
  };
  var hg = class extends Eo {
  };
  var Ao = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "requires_attention_mask", false);
      __publicField(this, "main_input_name", "input_values");
      __publicField(this, "forward_params", ["input_values", "decoder_input_ids", "past_key_values"]);
    }
  };
  var gg = class extends Ao {
  };
  var xg = class extends Ao {
  };
  var Kt = class extends h {
  };
  var wg = class extends Kt {
  };
  var yg = class extends Kt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var bg = class extends Kt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var kg = class extends Kt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var vg = class extends Kt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Mo = class extends h {
  };
  var Eg = class extends Mo {
  };
  var Ag = class extends Mo {
  };
  var So = class extends h {
  };
  var Mg = class extends So {
  };
  var Sg = class extends So {
  };
  var Ul = class extends h {
  };
  var Og = class extends Ul {
    constructor(...e) {
      super(...e);
      __publicField(this, "forward_params", ["input_ids", "pixel_values", "images_seq_mask", "images_emb_mask", "attention_mask", "position_ids", "past_key_values"]);
      this._generation_mode = "text";
    }
    async forward(e) {
      let s = this._generation_mode ?? "text", r;
      if (s === "text" || !e.past_key_values) {
        let l = this.sessions.prepare_inputs_embeds, c = ve(e, l.inputNames);
        r = await X(l, c);
      } else {
        let l = this.sessions.gen_img_embeds, c = ve({ image_ids: e.input_ids }, l.inputNames);
        r = await X(l, c);
      }
      let n = { ...e, ...r }, o = await Ve(this, n), i = this.sessions[s === "text" ? "lm_head" : "gen_head"];
      if (!i) throw new Error(`Unable to find "${i}" generation head`);
      let a = await X(i, ve(o, i.inputNames));
      return { ...r, ...o, ...a };
    }
    prepare_inputs_for_generation(e, s, r) {
      let n = !!s.past_key_values;
      return r.guidance_scale !== null && r.guidance_scale > 1 && (n ? s.input_ids = ie([s.input_ids, s.input_ids], 0) : (s.input_ids = ie([s.input_ids, Dr(s.input_ids, BigInt(r.pad_token_id))], 0), s.attention_mask = ie([s.attention_mask, Dr(s.attention_mask, 0n)], 0))), (n || !s.pixel_values) && (s.pixel_values = ke([0, 0, 3, 384, 384], 1)), n && (s.images_seq_mask = new E("bool", new Array(1).fill(true).fill(false, 0, 1), [1, 1]), s.images_emb_mask = new E("bool", new Array(0).fill(false), [1, 1, 0])), s;
    }
    async generate(e) {
      return this._generation_mode = "text", super.generate(e);
    }
    async generate_images(e) {
      this._generation_mode = "image";
      let s = (e.inputs ?? e[this.main_input_name]).dims[1], n = (await super.generate(e)).slice(null, [s, null]), o = this.sessions.image_decode, { decoded_image: i } = await X(o, { generated_tokens: n }), a = i.add_(1).mul_(255 / 2).clamp_(0, 255).to("uint8"), l = [];
      for (let c of a) {
        let p = Ee.fromTensor(c);
        l.push(p);
      }
      return l;
    }
  };
  var Oo = class extends h {
  };
  var Ig = class extends Oo {
  };
  var zg = class extends Oo {
  };
  var Io = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "encoder_outputs", "decoder_input_ids", "decoder_attention_mask", "past_key_values"]);
    }
    _apply_and_filter_by_delay_pattern_mask(e) {
      let [s, r] = e.dims, n = this.config.decoder.num_codebooks, o = r - n, i = 0;
      for (let c = 0; c < e.size; ++c) {
        if (e.data[c] == this.config.decoder.pad_token_id) continue;
        let p = c % r, u = Math.floor(c / r) % n, _ = p - u;
        _ > 0 && _ <= o && (e.data[i++] = e.data[c]);
      }
      let a = Math.floor(s / n), l = i / (a * n);
      return new E(e.type, e.data.slice(0, i), [a, n, l]);
    }
    prepare_inputs_for_generation(e, s, r) {
      let n = BigInt(this.config.decoder.pad_token_id), o = structuredClone(e);
      for (let i = 0; i < o.length; ++i) for (let a = 0; a < o[i].length; ++a) i % this.config.decoder.num_codebooks >= a && (o[i][a] = n);
      return r.guidance_scale !== null && r.guidance_scale > 1 && (o = o.concat(o)), an(this, o, s, r);
    }
    async generate(e) {
      let s = await super.generate(e), r = this._apply_and_filter_by_delay_pattern_mask(s).unsqueeze_(0), { audio_values: n } = await X(this.sessions.encodec_decode, { audio_codes: r });
      return n;
    }
  };
  var zo = class extends h {
  };
  var Tg = class extends zo {
  };
  var Cg = class extends zo {
  };
  var To = class extends h {
  };
  var Pg = class extends To {
  };
  var Ng = class extends To {
  };
  var Xt = class extends h {
  };
  var Lg = class extends Xt {
  };
  var $g = class extends Xt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Fg = class extends Xt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Rg = class extends Xt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Dg = class extends Xt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Gl = class extends h {
  };
  var qg = class extends Gl {
  };
  var Co = class extends h {
  };
  var jg = class extends Co {
  };
  var Bg = class extends Co {
  };
  var Po = class extends h {
  };
  var Ug = class extends Po {
  };
  var Gg = class extends Po {
  };
  var No = class extends h {
  };
  var Wg = class extends No {
  };
  var Vg = class extends No {
  };
  var Lo = class extends h {
  };
  var Hg = class extends Lo {
  };
  var Kg = class extends Lo {
  };
  var $o = class extends h {
  };
  var Xg = class extends $o {
  };
  var Qg = class extends $o {
  };
  var Fo = class extends h {
  };
  var Yg = class extends Fo {
  };
  var Jg = class extends Fo {
  };
  var Ro = class extends h {
  };
  var Zg = class extends Ro {
  };
  var ex = class extends Ro {
  };
  var Do = class extends h {
  };
  var tx = class extends Do {
  };
  var sx = class extends Do {
  };
  var rx = class extends Ue {
  };
  var Wl = class extends h {
  };
  var nx = class extends Wl {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var qo = class extends h {
  };
  var ox = class extends qo {
  };
  var ix = class extends qo {
  };
  var jo = class extends h {
  };
  var ax = class extends jo {
  };
  var lx = class extends jo {
  };
  var Bo = class extends h {
  };
  var cx = class extends Bo {
  };
  var px = class extends Bo {
  };
  var Uo = class extends h {
  };
  var ux = class extends Uo {
  };
  var _x = class extends Uo {
  };
  var Vl = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "inputs_embeds", "attention_mask", "position_ids", "pixel_values", "image_sizes", "past_key_values"]);
    }
  };
  var Go = class extends Vl {
    async forward({ input_ids: e = null, attention_mask: s = null, pixel_values: r = null, image_sizes: n = null, position_ids: o = null, inputs_embeds: i = null, past_key_values: a = null, generation_config: l = null, logits_processor: c = null, ...p }) {
      if (!i) {
        let _;
        if (r && e.dims[1] !== 1) {
          if (!n) throw new Error("`image_sizes` must be provided when `pixel_values` is provided.");
          ({ image_features: _ } = await X(this.sessions.vision_encoder, { pixel_values: r, image_sizes: n }));
        } else {
          let d = this.config.normalized_config.hidden_size;
          _ = new E("float32", [], [0, d]);
        }
        ({ inputs_embeds: i } = await X(this.sessions.prepare_inputs_embeds, { input_ids: e, image_features: _ }));
      }
      return await Ve(this, { inputs_embeds: i, past_key_values: a, attention_mask: s, position_ids: o, generation_config: l, logits_processor: c }, false);
    }
  };
  var Wo = class extends h {
  };
  var dx = class extends Wo {
  };
  var mx = class extends Wo {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Vo = class extends h {
  };
  var fx = class extends Vo {
  };
  var hx = class extends Vo {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Ho = class extends h {
  };
  var gx = class extends Ho {
  };
  var xx = class extends Ho {
  };
  var Ko = class extends h {
  };
  var wx = class extends Ko {
  };
  var yx = class extends Ko {
  };
  var Xo = class extends h {
  };
  var bx = class extends Xo {
  };
  var kx = class extends Xo {
  };
  var Qo = class extends h {
  };
  var vx = class extends Qo {
  };
  var Ex = class extends Qo {
  };
  var Yo = class extends h {
  };
  var Ax = class extends Yo {
  };
  var Mx = class extends Yo {
  };
  var ks = class extends gs {
  };
  var Jo = class extends Hn {
  };
  var Sx = class extends ks {
  };
  var Ox = class extends Jo {
  };
  var dr = class extends ks {
  };
  var Zo = class extends dr {
  };
  var Ix = class extends dr {
  };
  var zx = class extends Zo {
  };
  var ei = class extends h {
  };
  var Tx = class extends ei {
  };
  var Cx = class extends ei {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var ti = class extends h {
  };
  var Px = class extends ti {
  };
  var Nx = class extends ti {
    async _call(e) {
      return new Hl(await super._call(e));
    }
  };
  var Hl = class extends wt {
  };
  var Qt = class extends h {
  };
  var Lx = class extends Qt {
  };
  var $x = class extends Qt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Fx = class extends Qt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Rx = class extends Qt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Dx = class extends Qt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var Yt = class extends h {
  };
  var qx = class extends Yt {
  };
  var jx = class extends Yt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var Bx = class extends Yt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Ux = class extends Yt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var Gx = class extends Yt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var si = class extends h {
  };
  var Wx = class extends si {
  };
  var Vx = class extends si {
    async _call(e) {
      return new Kl(await super._call(e));
    }
  };
  var Kl = class extends wt {
  };
  var Xl = class extends he {
    constructor({ iou_scores: e, pred_masks: s }) {
      super(), this.iou_scores = e, this.pred_masks = s;
    }
  };
  var Ql = class extends h {
  };
  var Hx = class extends Ql {
    async get_image_embeddings({ pixel_values: e }) {
      return await st(this, { pixel_values: e });
    }
    async forward(e) {
      !e.image_embeddings || !e.image_positional_embeddings ? e = { ...e, ...await this.get_image_embeddings(e) } : e = { ...e }, e.input_labels ?? (e.input_labels = Me(e.input_points.dims.slice(0, -1)));
      let s = { image_embeddings: e.image_embeddings, image_positional_embeddings: e.image_positional_embeddings };
      return e.input_points && (s.input_points = e.input_points), e.input_labels && (s.input_labels = e.input_labels), e.input_boxes && (s.input_boxes = e.input_boxes), await X(this.sessions.prompt_encoder_mask_decoder, s);
    }
    async _call(e) {
      return new Xl(await super._call(e));
    }
  };
  var Yl = class extends he {
    constructor({ iou_scores: e, pred_masks: s, object_score_logits: r }) {
      super(), this.iou_scores = e, this.pred_masks = s, this.object_score_logits = r;
    }
  };
  var Jl = class extends h {
  };
  var ri = class extends Jl {
    async get_image_embeddings({ pixel_values: e }) {
      return await st(this, { pixel_values: e });
    }
    async forward(e) {
      let { num_feature_levels: s } = this.config.vision_config;
      if (Array.from({ length: s }, (i, a) => `image_embeddings.${a}`).some((i) => !e[i]) ? e = { ...e, ...await this.get_image_embeddings(e) } : e = { ...e }, e.input_points) {
        if (e.input_boxes && e.input_boxes.dims[1] !== 1) throw new Error("When both `input_points` and `input_boxes` are provided, the number of boxes per image must be 1.");
        let i = e.input_points.dims;
        e.input_labels ?? (e.input_labels = Me(i.slice(0, -1))), e.input_boxes ?? (e.input_boxes = ke([i[0], 0, 4], 0));
      } else if (e.input_boxes) {
        let i = e.input_boxes.dims;
        e.input_labels = ke([i[0], i[1], 0], -1n), e.input_points = ke([i[0], 1, 0, 2], 0);
      } else throw new Error("At least one of `input_points` or `input_boxes` must be provided.");
      let n = this.sessions.prompt_encoder_mask_decoder, o = ve(e, n.inputNames);
      return await X(n, o);
    }
    async _call(e) {
      return new Yl(await super._call(e));
    }
  };
  var Kx = class extends ri {
  };
  var Xx = class extends ri {
  };
  var mr = class extends h {
  };
  var Qx = class extends mr {
  };
  var Yx = class extends mr {
  };
  var Jx = class extends mr {
  };
  var fr = class extends h {
  };
  var Zx = class extends fr {
  };
  var ew = class extends fr {
  };
  var tw = class extends fr {
  };
  var ni = class extends h {
  };
  var sw = class extends ni {
  };
  var oi = class extends ni {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "text_model" });
    }
  };
  var rw = class extends xt {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "vision_model" });
    }
  };
  var ii = class extends h {
  };
  var nw = class extends ii {
  };
  var ow = class extends ii {
  };
  var hr = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "main_input_name", "input_values");
      __publicField(this, "forward_params", ["input_values"]);
    }
  };
  var iw = class extends hr {
    async encode(e) {
      return await X(this.sessions.encoder_model, e);
    }
    async decode(e) {
      return await X(this.sessions.decoder_model, e);
    }
  };
  var ai = class extends hr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "encoder_model" });
    }
  };
  var li = class extends hr {
    static async from_pretrained(e, s = {}) {
      return super.from_pretrained(e, { ...s, model_file_name: s.model_file_name ?? "decoder_model" });
    }
  };
  var ci = class extends h {
  };
  var aw = class extends ci {
  };
  var lw = class extends ci {
  };
  var gr = class extends h {
  };
  var cw = class extends gr {
  };
  var pw = class extends gr {
  };
  var uw = class extends gr {
    async generate_speech(e, s, { threshold: r = 0.5, minlenratio: n = 0, maxlenratio: o = 20, vocoder: i = null } = {}) {
      let a = { input_ids: e }, { encoder_outputs: l, encoder_attention_mask: c } = await st(this, a), p = l.dims[1] / this.config.reduction_factor, u = Math.floor(p * o), _ = Math.floor(p * n), d = this.config.num_mel_bins, m = [], f = null, g = null, x = 0;
      for (; ; ) {
        ++x;
        let b = V_(!!g), v;
        g ? v = g.output_sequence_out : v = new E("float32", new Float32Array(d), [1, 1, d]);
        let k = { use_cache_branch: b, output_sequence: v, encoder_attention_mask: c, speaker_embeddings: s, encoder_hidden_states: l };
        this.addPastKeyValues(k, f), g = await X(this.sessions.decoder_model_merged, k), f = this.getPastKeyValues(g, f);
        let { prob: S, spectrum: I } = g;
        if (m.push(I), x >= _ && (Array.from(S.data).filter(($) => $ >= r).length > 0 || x >= u)) break;
      }
      let w = ie(m), { waveform: y } = await X(i.sessions.model, { spectrogram: w });
      return { spectrogram: w, waveform: y };
    }
  };
  var _w = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "main_input_name", "spectrogram");
    }
  };
  var vs = class extends h {
  };
  var dw = class extends vs {
  };
  var mw = class extends vs {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var fw = class extends vs {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var hw = class extends vs {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var pi = class extends h {
  };
  var gw = class extends pi {
  };
  var xw = class extends pi {
  };
  var ui = class extends h {
  };
  var ww = class extends ui {
  };
  var yw = class extends ui {
  };
  var Zl = class extends h {
  };
  var bw = class extends Zl {
  };
  var ec = class extends h {
  };
  var _i = class extends ec {
    async generate_speech({ input_ids: e, attention_mask: s, style: r, num_inference_steps: n = 5, speed: o = 1.05 }) {
      let { sampling_rate: i, chunk_compress_factor: a, base_chunk_size: l, latent_dim: c } = this.config, { last_hidden_state: p, durations: u } = await X(this.sessions.text_encoder, { input_ids: e, attention_mask: s, style: r }), _ = u.div(o).mul_(i), d = l * a, m = _.data, f = Int32Array.from(m, (C) => Math.ceil(C / d)), g = Math.max(...f), x = e.dims[0], w = new BigInt64Array(x * g);
      for (let C = 0; C < x; ++C) w.fill(1n, C * g, C * g + f[C]);
      let y = new E("int64", w, [x, g]), b = c * a, v = b * g, k = J0([x, b, g]), S = k.data;
      for (let C = 0; C < x; ++C) if (f[C] !== g) for (let q = 0; q < b; ++q) S.fill(0, C * v + q * g + f[C], C * v + (q + 1) * g);
      let I = ke([x], n);
      for (let C = 0; C < n; ++C) {
        let q = ke([x], C);
        ({ denoised_latents: k } = await X(this.sessions.latent_denoiser, { style: r, noisy_latents: k, latent_mask: y, encoder_outputs: p, attention_mask: s, timestep: q, num_inference_steps: I }));
      }
      let { waveform: $ } = await X(this.sessions.voice_decoder, { latents: k });
      return { waveform: $, durations: _ };
    }
  };
  var xr = class extends h {
  };
  var kw = class extends xr {
  };
  var vw = class extends xr {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Ew = class extends xr {
  };
  var di = class extends h {
  };
  var Aw = class extends di {
  };
  var Mw = class extends di {
  };
  var mi = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "encoder_outputs", "decoder_input_ids", "decoder_attention_mask", "past_key_values"]);
    }
  };
  var Sw = class extends mi {
  };
  var Ow = class extends mi {
  };
  var fi = class extends h {
  };
  var Iw = class extends fi {
  };
  var zw = class extends fi {
    async _call(e) {
      return new tc(await super._call(e));
    }
  };
  var tc = class extends nr {
  };
  var sc = class extends h {
  };
  var Tw = class extends sc {
  };
  var wr = class extends h {
  };
  var Cw = class extends wr {
  };
  var Pw = class extends wr {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var Nw = class extends wr {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Es = class extends h {
  };
  var Lw = class extends Es {
  };
  var $w = class extends Es {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var Fw = class extends Es {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var Rw = class extends Es {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var hi = class extends h {
  };
  var Dw = class extends hi {
  };
  var qw = class extends hi {
  };
  var jw = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "main_input_name", "pixel_values");
      __publicField(this, "forward_params", ["pixel_values", "decoder_input_ids", "encoder_hidden_states", "past_key_values"]);
    }
  };
  var gi = class extends h {
  };
  var Bw = class extends gi {
  };
  var Uw = class extends gi {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var rc = class extends h {
  };
  var Gw = class extends rc {
  };
  var xi = class extends h {
  };
  var Ww = class extends xi {
  };
  var Vw = class extends xi {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var nc = class extends h {
  };
  var Hw = class extends nc {
    async _call(e) {
      return new Ya(await super._call(e));
    }
  };
  var oc = class extends h {
  };
  var Kw = class extends oc {
  };
  var ic = class extends he {
    constructor({ waveform: e, spectrogram: s }) {
      super(), this.waveform = e, this.spectrogram = s;
    }
  };
  var ac = class extends h {
  };
  var Xw = class extends ac {
    async _call(e) {
      return new ic(await super._call(e));
    }
  };
  var Qw = class extends xs {
  };
  var Ib = 2;
  var lM = 1;
  var Yw = /* @__PURE__ */ new WeakMap();
  function cM(t6, e) {
    let { text_config: s, audio_config: r } = t6.config, n = t6.sessions.audio_encoder, { num_mel_bins: o, hidden_size: i } = r, a = o + i, l = new rn(), c = n?.config?.kv_cache_dtype ?? "float32", p = c === "float16" ? bt.float16 : bt.float32, u = cs(r, { batch_size: 1 });
    for (let m in u) {
      let f = u[m].reduce((g, x) => g * x, 1);
      l[m] = new E(c, new p(f), u[m]);
    }
    let _ = new E(c, new p(a * Ib), [1, a, Ib]), d = e[Symbol.asyncIterator]?.() ?? e[Symbol.iterator]?.();
    if (!d) throw new Error("input_features must be iterable or async iterable");
    return { encoder_session: n, enc_kv_cache: l, enc_padding_cache: _, enc_past_seq_len: 0, audio_embed_queue: [], audio_embed_total_tokens: 0, audio_queue_offset: 0, audio_consumed: 0, stream_exhausted: false, chunks_iter: d, text_hidden_size: s.hidden_size };
  }
  async function pM(t6, e) {
    let s = e.dims[2], r = Math.floor((lM + s - 3) / 2) + 1, n = new E("int64", BigInt64Array.from({ length: r }, (p, u) => BigInt(t6.enc_past_seq_len + u)), [1, r]), o = t6.enc_past_seq_len + r, i = Me([1, o]), { audio_embeds: a, present_padding_cache: l, ...c } = await X(t6.encoder_session, { input_features: e, attention_mask: i, position_ids: n, past_padding_cache: t6.enc_padding_cache, ...t6.enc_kv_cache });
    t6.enc_padding_cache.location === "gpu-buffer" && t6.enc_padding_cache.dispose(), t6.enc_padding_cache = l;
    for (let p in c) if (p.startsWith("present.")) {
      let u = p.replace("present", "past_key_values"), _ = t6.enc_kv_cache[u];
      _?.location === "gpu-buffer" && _.dispose(), t6.enc_kv_cache[u] = c[p];
    }
    return t6.enc_past_seq_len = o, a;
  }
  async function uM(t6, e) {
    for (; t6.audio_embed_total_tokens < e && !t6.stream_exhausted; ) {
      let s = await t6.chunks_iter.next();
      if (s.done) {
        t6.stream_exhausted = true;
        break;
      }
      let r = await pM(t6, s.value);
      t6.audio_embed_queue.push({ data: r.data, tokens: r.dims[1] }), t6.audio_embed_total_tokens += r.dims[1];
    }
  }
  function _M(t6, e, s) {
    if (t6.audio_embed_queue.length === 0) return;
    let r = e.data, n = 0, o = s;
    for (; o > 0 && t6.audio_embed_queue.length > 0; ) {
      let i = t6.audio_embed_queue[0], a = i.tokens - t6.audio_queue_offset, l = Math.min(o, a), c = t6.audio_queue_offset * t6.text_hidden_size;
      for (let p = 0; p < l * t6.text_hidden_size; ++p) r[n * t6.text_hidden_size + p] += i.data[c + p];
      n += l, o -= l, t6.audio_queue_offset += l, t6.audio_queue_offset >= i.tokens && (t6.audio_embed_queue.shift(), t6.audio_queue_offset = 0);
    }
    t6.audio_consumed += s - o;
  }
  var Jw = class extends Dt {
    constructor(e) {
      super(), this._s = e;
    }
    _call(e) {
      let s = this._s.stream_exhausted && this._s.audio_embed_queue.length === 0;
      return e.map(() => s);
    }
  };
  var lc = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "forward_params", ["input_ids", "attention_mask", "position_ids", "past_key_values"]);
    }
  };
  var wi = class extends lc {
    async forward({ input_ids: e, past_key_values: s, ...r }) {
      let n = e.dims[1], o = Yw.get(this);
      o && await uM(o, o.audio_consumed + n);
      let { inputs_embeds: i } = await X(this.sessions.embed_tokens, { input_ids: e });
      o && _M(o, i, n);
      let a = { inputs_embeds: i, ...r };
      this.addPastKeyValues(a, s);
      let l = this.sessions.decoder_model_merged, c = ve(a, l.inputNames);
      return await X(l, c);
    }
    async generate({ input_features: e, stopping_criteria: s, ...r }) {
      if (!e) throw new Error("input_features (generator/iterable) must be provided");
      let n = cM(this, e);
      Yw.set(this, n);
      let o = new Xs();
      o.push(new Jw(n)), s && o.extend(s);
      try {
        return await super.generate({ ...r, stopping_criteria: o });
      } finally {
        n.enc_kv_cache.dispose(), Yw.delete(this);
      }
    }
  };
  var yr = class extends h {
  };
  var Zw = class extends yr {
  };
  var ey = class extends yr {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var ty = class extends yr {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var cc = class extends he {
    constructor({ logits: e, embeddings: s }) {
      super(), this.logits = e, this.embeddings = s;
    }
  };
  var Jt = class extends h {
  };
  var sy = class extends Jt {
  };
  var ry = class extends Jt {
    async _call(e) {
      return new Be(await super._call(e));
    }
  };
  var ny = class extends Jt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var oy = class extends Jt {
    async _call(e) {
      return new cc(await super._call(e));
    }
  };
  var iy = class extends Jt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var pc = class extends h {
  };
  var ay = class extends pc {
  };
  var uc = class extends Ks {
    constructor() {
      super(...arguments);
      __publicField(this, "return_timestamps", null);
      __publicField(this, "return_token_timestamps", null);
      __publicField(this, "num_frames", null);
      __publicField(this, "alignment_heads", null);
      __publicField(this, "task", null);
      __publicField(this, "language", null);
      __publicField(this, "no_timestamps_token_id", null);
      __publicField(this, "prompt_ids", null);
      __publicField(this, "is_multilingual", null);
      __publicField(this, "lang_to_id", null);
      __publicField(this, "task_to_id", null);
      __publicField(this, "max_initial_timestamp_index", 1);
    }
  };
  var yi = class extends h {
    constructor() {
      super(...arguments);
      __publicField(this, "requires_attention_mask", false);
      __publicField(this, "main_input_name", "input_features");
      __publicField(this, "forward_params", ["input_features", "attention_mask", "decoder_input_ids", "decoder_attention_mask", "past_key_values"]);
    }
  };
  var ly = class extends yi {
  };
  var _c = class extends yi {
    _prepare_generation_config(e, s) {
      return super._prepare_generation_config(e, s, uc);
    }
    _retrieve_init_tokens(e) {
      let s = [e.decoder_start_token_id], r = e.language, n = e.task;
      if (e.is_multilingual) {
        r || (F.warn("No language specified - defaulting to English (en)."), r = "en");
        let i = `<|${tb(r)}|>`;
        s.push(e.lang_to_id[i]), s.push(e.task_to_id[n ?? "transcribe"]);
      } else if (r || n) throw new Error("Cannot specify `task` or `language` for an English-only model. If the model is intended to be multilingual, pass `is_multilingual=true` to generate, or update the generation config.");
      return !e.return_timestamps && e.no_timestamps_token_id && s.at(-1) !== e.no_timestamps_token_id ? s.push(e.no_timestamps_token_id) : e.return_timestamps && s.at(-1) === e.no_timestamps_token_id && (F.warn("<|notimestamps|> prompt token is removed from generation_config since `return_timestamps` is set to `true`."), s.pop()), s.filter((o) => o != null);
    }
    async generate({ inputs: e = null, generation_config: s = null, logits_processor: r = null, stopping_criteria: n = null, ...o }) {
      s = this._prepare_generation_config(s, o);
      let i = o.decoder_input_ids ?? this._retrieve_init_tokens(s);
      if (s.return_timestamps && (r ?? (r = new ps()), r.push(new tl(s, i))), s.begin_suppress_tokens && (r ?? (r = new ps()), r.push(new Hs(s.begin_suppress_tokens, i.length))), s.return_token_timestamps) {
        if (!s.alignment_heads) throw new Error("Model generation config has no `alignment_heads`, token-level timestamps not available. See https://gist.github.com/hollance/42e32852f24243b748ae6bc1f985b13a on how to add this property to the generation config.");
        s.task === "translate" && F.warn("Token-level timestamps may not be reliable for task 'translate'."), s.output_attentions = true, s.return_dict_in_generate = true;
      }
      if (s.return_timestamps && !o.max_new_tokens) return this._generate_with_seek({ inputs: e, generation_config: s, logits_processor: r, init_tokens: i, kwargs: o });
      let a = await super.generate({ inputs: e, generation_config: s, logits_processor: r, decoder_input_ids: i, ...o });
      return s.return_token_timestamps && (a.token_timestamps = this._extract_token_timestamps(a, s.alignment_heads, s.num_frames, 0.02, i.length)), a;
    }
    async _generate_with_seek({ inputs: e, generation_config: s, logits_processor: r, init_tokens: n, kwargs: o }) {
      let i = s.no_timestamps_token_id + 1, a = Array.isArray(s.eos_token_id) ? s.eos_token_id[0] : s.eos_token_id, l = s.return_token_timestamps, c = e, p = c.dims[2], u = 2, _ = this.config.max_source_positions, d = u * _, m = 0, f = [], g = [];
      for (; m < p; ) {
        let w = Math.min(m + d, p), y = c.slice(null, null, [m, w]), b, v = y.dims[2];
        if (v < d) {
          let R = c.dims[1], A = new Float32Array(R * d), O = y.data;
          for (let z = 0; z < R; ++z) A.set(O.subarray(z * v, (z + 1) * v), z * d);
          b = new E("float32", A, [1, R, d]);
        } else b = y;
        if (r) for (let R of r) "begin_index" in R && (R.begin_index = n.length);
        let k = await super.generate({ inputs: b, generation_config: s, logits_processor: r, decoder_input_ids: n, ...o }), I = (l ? k.sequences : k)[0].tolist().map(Number).slice(n.length), $;
        if (l) {
          k.token_timestamps = this._extract_token_timestamps(k, s.alignment_heads, Math.floor((w - m) / u), 0.02, n.length);
          let R = m / u * 0.02;
          $ = k.token_timestamps[0].tolist().slice(n.length).map((A) => A + R);
        }
        if (I.length > 0 && I.at(-1) === a && I.pop(), I.length === 0) break;
        let C = I.map((R) => R >= i), q = I.length >= 2 && C[I.length - 1] && !C[I.length - 2], D = [];
        for (let R = 0; R < I.length - 1; ++R) C[R] && C[R + 1] && D.push(R + 1);
        let B, H = I.length;
        if (D.length > 0) if (q) B = w - m;
        else {
          let R = D.at(-1);
          B = (I[R - 1] - i) * u, H = R;
        }
        else B = w - m;
        let V = Math.floor(m / u), Z = i + 1500;
        for (let R = 0; R < H; ++R) I[R] >= i && (I[R] = Math.min(I[R] + V, Z));
        f.push(...I.slice(0, H)), $ && g.push(...$.slice(0, H)), m += B;
      }
      f.push(a);
      let x = [...n, ...f];
      if (l) {
        let w = new E("int64", x.map(BigInt), [1, x.length]), y = [...new Array(n.length).fill(0), ...g, 0], b = new E("float32", new Float32Array(y), [1, y.length]);
        return { sequences: w, token_timestamps: b };
      }
      return new E("int64", x.map(BigInt), [1, x.length]);
    }
    _extract_token_timestamps(e, s, r = null, n = 0.02, o = 0) {
      if (!e.cross_attentions) throw new Error("Model outputs must contain cross attentions to extract timestamps. This is most likely because the model was not exported with `output_attentions=True`.");
      r == null && F.warn("`num_frames` has not been set, meaning the entire audio will be analyzed. This may lead to inaccurate token-level timestamps for short audios (< 30 seconds).");
      let i = this.config.median_filter_width;
      i === void 0 && (F.warn("Model config has no `median_filter_width`, using default value of 7."), i = 7);
      let a = e.cross_attentions, l = Array.from({ length: this.config.decoder_layers }, (x, w) => ie(a.map((y) => y[w]), 2)), c = qe(s.map(([x, w]) => {
        if (x >= l.length) throw new Error(`Layer index ${x} is out of bounds for cross attentions (length ${l.length}).`);
        return r ? l[x].slice(null, w, null, [0, r]) : l[x].slice(null, w);
      })).transpose(1, 0, 2, 3), [p, u] = np(c, -2, 0, true), _ = c.clone();
      for (let x = 0; x < _.dims[0]; ++x) {
        let w = _[x];
        for (let y = 0; y < w.dims[0]; ++y) {
          let b = w[y], v = p[x][y][0].data, k = u[x][y][0].data;
          for (let S = 0; S < b.dims[0]; ++S) {
            let I = b[S].data;
            for (let $ = 0; $ < I.length; ++$) I[$] = (I[$] - k[$]) / v[$];
            I.set(T0(I, i));
          }
        }
      }
      let d = o > 0 ? _.slice(null, null, [o, _.dims[2]], null) : _, m = [ya(d, 1)], f = e.sequences.dims, g = new E("float32", new Float32Array(f[0] * f[1]), f);
      for (let x = 0; x < f[0]; ++x) {
        let w = m[x].neg().squeeze_(0), [y, b] = P0(w.tolist()), v = Array.from({ length: y.length - 1 }, ($, C) => y[C + 1] - y[C]), k = Fe([1], v).map(($) => !!$), S = [];
        for (let $ = 0; $ < k.length; ++$) k[$] && S.push(b[$] * n);
        let I = new Array(o).fill(0);
        I.push(...S), S.length > 0 && I.push(S.at(-1)), g[x].data.set(I);
      }
      return g;
    }
  };
  var cy = class extends _c {
  };
  var Zt = class extends h {
  };
  var py = class extends Zt {
  };
  var uy = class extends Zt {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var _y = class extends Zt {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var dy = class extends Zt {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var my = class extends Zt {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var es = class extends h {
  };
  var fy = class extends es {
  };
  var hy = class extends es {
    async _call(e) {
      return new ne(await super._call(e));
    }
  };
  var gy = class extends es {
    async _call(e) {
      return new T(await super._call(e));
    }
  };
  var xy = class extends es {
    async _call(e) {
      return new se(await super._call(e));
    }
  };
  var wy = class extends es {
    async _call(e) {
      return new ue(await super._call(e));
    }
  };
  var bi = class extends h {
  };
  var yy = class extends bi {
  };
  var by = class extends bi {
    async _call(e) {
      return new dc(await super._call(e));
    }
  };
  var dc = class extends he {
    constructor({ logits: e, pred_boxes: s }) {
      super(), this.logits = e, this.pred_boxes = s;
    }
  };
  var ki = class extends h {
  };
  var ky = class extends ki {
  };
  var vy = class extends ki {
  };
  var dM = /* @__PURE__ */ new Map([["bert", "BertModel"], ["eurobert", "EuroBertModel"], ["neobert", "NeoBertModel"], ["modernbert", "ModernBertModel"], ["nomic_bert", "NomicBertModel"], ["roformer", "RoFormerModel"], ["electra", "ElectraModel"], ["esm", "EsmModel"], ["convbert", "ConvBertModel"], ["camembert", "CamembertModel"], ["deberta", "DebertaModel"], ["deberta-v2", "DebertaV2Model"], ["mpnet", "MPNetModel"], ["albert", "AlbertModel"], ["distilbert", "DistilBertModel"], ["roberta", "RobertaModel"], ["xlm", "XLMModel"], ["xlm-roberta", "XLMRobertaModel"], ["clap", "ClapModel"], ["clip", "CLIPModel"], ["clipseg", "CLIPSegModel"], ["chinese_clip", "ChineseCLIPModel"], ["siglip", "SiglipModel"], ["jina_clip", "JinaCLIPModel"], ["mobilebert", "MobileBertModel"], ["squeezebert", "SqueezeBertModel"], ["wav2vec2", "Wav2Vec2Model"], ["wav2vec2-bert", "Wav2Vec2BertModel"], ["unispeech", "UniSpeechModel"], ["unispeech-sat", "UniSpeechSatModel"], ["hubert", "HubertModel"], ["wavlm", "WavLMModel"], ["audio-spectrogram-transformer", "ASTModel"], ["vits", "VitsModel"], ["pyannote", "PyAnnoteModel"], ["wespeaker-resnet", "WeSpeakerResNetModel"], ["detr", "DetrModel"], ["rt_detr", "RTDetrModel"], ["rt_detr_v2", "RTDetrV2Model"], ["rf_detr", "RFDetrModel"], ["d_fine", "DFineModel"], ["table-transformer", "TableTransformerModel"], ["vit", "ViTModel"], ["ijepa", "IJepaModel"], ["pvt", "PvtModel"], ["vit_msn", "ViTMSNModel"], ["vit_mae", "ViTMAEModel"], ["groupvit", "GroupViTModel"], ["fastvit", "FastViTModel"], ["mobilevit", "MobileViTModel"], ["mobilevitv2", "MobileViTV2Model"], ["owlvit", "OwlViTModel"], ["owlv2", "Owlv2Model"], ["beit", "BeitModel"], ["deit", "DeiTModel"], ["hiera", "HieraModel"], ["convnext", "ConvNextModel"], ["convnextv2", "ConvNextV2Model"], ["dinov2", "Dinov2Model"], ["dinov2_with_registers", "Dinov2WithRegistersModel"], ["dinov3_vit", "DINOv3ViTModel"], ["dinov3_convnext", "DINOv3ConvNextModel"], ["resnet", "ResNetModel"], ["swin", "SwinModel"], ["swin2sr", "Swin2SRModel"], ["donut-swin", "DonutSwinModel"], ["yolos", "YolosModel"], ["dpt", "DPTModel"], ["glpn", "GLPNModel"], ["hifigan", "SpeechT5HifiGan"], ["efficientnet", "EfficientNetModel"], ["decision_transformer", "DecisionTransformerModel"], ["patchtst", "PatchTSTModel"], ["patchtsmixer", "PatchTSMixerModel"], ["mobilenet_v1", "MobileNetV1Model"], ["mobilenet_v2", "MobileNetV2Model"], ["mobilenet_v3", "MobileNetV3Model"], ["mobilenet_v4", "MobileNetV4Model"], ["maskformer", "MaskFormerModel"], ["mgp-str", "MgpstrForSceneTextRecognition"], ["style_text_to_speech_2", "StyleTextToSpeech2Model"]]);
  var mM = /* @__PURE__ */ new Map([["t5", "T5Model"], ["longt5", "LongT5Model"], ["mt5", "MT5Model"], ["bart", "BartModel"], ["mbart", "MBartModel"], ["marian", "MarianModel"], ["whisper", "WhisperModel"], ["cohere_asr", "CohereAsrModel"], ["m2m_100", "M2M100Model"], ["blenderbot", "BlenderbotModel"], ["blenderbot-small", "BlenderbotSmallModel"]]);
  var fM = /* @__PURE__ */ new Map([["mimi", "MimiModel"], ["dac", "DacModel"], ["snac", "SnacModel"]]);
  var hM = /* @__PURE__ */ new Map([["bloom", "BloomModel"], ["jais", "JAISModel"], ["gpt2", "GPT2Model"], ["gpt_oss", "GptOssModel"], ["gptj", "GPTJModel"], ["gpt_bigcode", "GPTBigCodeModel"], ["gpt_neo", "GPTNeoModel"], ["gpt_neox", "GPTNeoXModel"], ["codegen", "CodeGenModel"], ["llama", "LlamaModel"], ["apertus", "ApertusModel"], ["nanochat", "NanoChatModel"], ["arcee", "ArceeModel"], ["afmoe", "AfmoeModel"], ["lfm2", "Lfm2Model"], ["lfm2_moe", "Lfm2MoeModel"], ["smollm3", "SmolLM3Model"], ["exaone", "ExaoneModel"], ["olmo", "OlmoModel"], ["olmo2", "Olmo2Model"], ["olmo3", "Olmo3Model"], ["olmo_hybrid", "OlmoHybridModel"], ["mobilellm", "MobileLLMModel"], ["granite", "GraniteModel"], ["granitemoehybrid", "GraniteMoeHybridModel"], ["cohere", "CohereModel"], ["cohere2", "Cohere2Model"], ["gemma", "GemmaModel"], ["gemma2", "Gemma2Model"], ["vaultgemma", "VaultGemmaModel"], ["gemma3_text", "Gemma3Model"], ["helium", "HeliumModel"], ["glm", "GlmModel"], ["glm_moe_dsa", "GlmMoeDsaModel"], ["openelm", "OpenELMModel"], ["qwen2", "Qwen2Model"], ["qwen2_moe", "Qwen2MoeModel"], ["qwen3", "Qwen3Model"], ["qwen3_moe", "Qwen3MoeModel"], ["qwen3_next", "Qwen3NextModel"], ["phi", "PhiModel"], ["phi3", "Phi3Model"], ["mpt", "MptModel"], ["opt", "OPTModel"], ["mistral", "MistralModel"], ["mistral4", "Mistral4Model"], ["ministral", "MinistralModel"], ["ministral3", "Ministral3Model"], ["ernie4_5", "Ernie4_5ForCausalLM"], ["starcoder2", "Starcoder2Model"], ["deepseek_v3", "DeepseekV3Model"], ["falcon", "FalconModel"], ["falcon_h1", "FalconH1Model"], ["nemotron_h", "NemotronHModel"], ["solar_open", "SolarOpenModel"], ["stablelm", "StableLmModel"], ["modernbert-decoder", "ModernBertDecoderModel"], ["hunyuan_v1_dense", "HunYuanDenseV1Model"], ["youtu", "YoutuModel"]]);
  var zb = /* @__PURE__ */ new Map([["speecht5", "SpeechT5ForSpeechToText"], ["whisper", "WhisperForConditionalGeneration"], ["lite-whisper", "LiteWhisperForConditionalGeneration"], ["moonshine", "MoonshineForConditionalGeneration"], ["cohere_asr", "CohereAsrForConditionalGeneration"]]);
  var Tb = /* @__PURE__ */ new Map([["speecht5", "SpeechT5ForTextToSpeech"]]);
  var Cb = /* @__PURE__ */ new Map([["vits", "VitsModel"], ["musicgen", "MusicgenForConditionalGeneration"], ["supertonic", "SupertonicForConditionalGeneration"]]);
  var Pb = /* @__PURE__ */ new Map([["bert", "BertForSequenceClassification"], ["eurobert", "EuroBertForSequenceClassification"], ["neobert", "NeoBertForSequenceClassification"], ["modernbert", "ModernBertForSequenceClassification"], ["roformer", "RoFormerForSequenceClassification"], ["electra", "ElectraForSequenceClassification"], ["esm", "EsmForSequenceClassification"], ["convbert", "ConvBertForSequenceClassification"], ["camembert", "CamembertForSequenceClassification"], ["deberta", "DebertaForSequenceClassification"], ["deberta-v2", "DebertaV2ForSequenceClassification"], ["mpnet", "MPNetForSequenceClassification"], ["albert", "AlbertForSequenceClassification"], ["distilbert", "DistilBertForSequenceClassification"], ["roberta", "RobertaForSequenceClassification"], ["xlm", "XLMForSequenceClassification"], ["xlm-roberta", "XLMRobertaForSequenceClassification"], ["bart", "BartForSequenceClassification"], ["mbart", "MBartForSequenceClassification"], ["mobilebert", "MobileBertForSequenceClassification"], ["squeezebert", "SqueezeBertForSequenceClassification"]]);
  var Nb = /* @__PURE__ */ new Map([["bert", "BertForTokenClassification"], ["eurobert", "EuroBertForTokenClassification"], ["neobert", "NeoBertForTokenClassification"], ["modernbert", "ModernBertForTokenClassification"], ["roformer", "RoFormerForTokenClassification"], ["electra", "ElectraForTokenClassification"], ["esm", "EsmForTokenClassification"], ["convbert", "ConvBertForTokenClassification"], ["camembert", "CamembertForTokenClassification"], ["deberta", "DebertaForTokenClassification"], ["deberta-v2", "DebertaV2ForTokenClassification"], ["mpnet", "MPNetForTokenClassification"], ["distilbert", "DistilBertForTokenClassification"], ["roberta", "RobertaForTokenClassification"], ["xlm", "XLMForTokenClassification"], ["xlm-roberta", "XLMRobertaForTokenClassification"]]);
  var Lb = /* @__PURE__ */ new Map([["t5", "T5ForConditionalGeneration"], ["longt5", "LongT5ForConditionalGeneration"], ["mt5", "MT5ForConditionalGeneration"], ["bart", "BartForConditionalGeneration"], ["mbart", "MBartForConditionalGeneration"], ["marian", "MarianMTModel"], ["m2m_100", "M2M100ForConditionalGeneration"], ["blenderbot", "BlenderbotForConditionalGeneration"], ["blenderbot-small", "BlenderbotSmallForConditionalGeneration"]]);
  var $b = /* @__PURE__ */ new Map([["bloom", "BloomForCausalLM"], ["gpt2", "GPT2LMHeadModel"], ["gpt_oss", "GptOssForCausalLM"], ["jais", "JAISLMHeadModel"], ["gptj", "GPTJForCausalLM"], ["gpt_bigcode", "GPTBigCodeForCausalLM"], ["gpt_neo", "GPTNeoForCausalLM"], ["gpt_neox", "GPTNeoXForCausalLM"], ["codegen", "CodeGenForCausalLM"], ["llama", "LlamaForCausalLM"], ["nanochat", "NanoChatForCausalLM"], ["apertus", "ApertusForCausalLM"], ["llama4_text", "Llama4ForCausalLM"], ["arcee", "ArceeForCausalLM"], ["afmoe", "AfmoeForCausalLM"], ["lfm2", "Lfm2ForCausalLM"], ["lfm2_moe", "Lfm2MoeForCausalLM"], ["smollm3", "SmolLM3ForCausalLM"], ["exaone", "ExaoneForCausalLM"], ["olmo", "OlmoForCausalLM"], ["olmo2", "Olmo2ForCausalLM"], ["olmo3", "Olmo3ForCausalLM"], ["olmo_hybrid", "OlmoHybridForCausalLM"], ["mobilellm", "MobileLLMForCausalLM"], ["granite", "GraniteForCausalLM"], ["granitemoehybrid", "GraniteMoeHybridForCausalLM"], ["cohere", "CohereForCausalLM"], ["cohere2", "Cohere2ForCausalLM"], ["gemma", "GemmaForCausalLM"], ["gemma2", "Gemma2ForCausalLM"], ["vaultgemma", "VaultGemmaForCausalLM"], ["gemma3_text", "Gemma3ForCausalLM"], ["gemma3", "Gemma3ForCausalLM"], ["helium", "HeliumForCausalLM"], ["glm", "GlmForCausalLM"], ["glm_moe_dsa", "GlmMoeDsaForCausalLM"], ["openelm", "OpenELMForCausalLM"], ["qwen2", "Qwen2ForCausalLM"], ["qwen2_moe", "Qwen2MoeForCausalLM"], ["qwen3", "Qwen3ForCausalLM"], ["qwen3_moe", "Qwen3MoeForCausalLM"], ["qwen3_next", "Qwen3NextForCausalLM"], ["qwen2_vl", "Qwen2VLForCausalLM"], ["qwen2_5_vl", "Qwen2_5_VLForCausalLM"], ["qwen3_vl", "Qwen3VLForCausalLM"], ["qwen3_vl_moe", "Qwen3VLMoeForCausalLM"], ["qwen3_5", "Qwen3_5ForCausalLM"], ["qwen3_5_text", "Qwen3_5ForCausalLM"], ["qwen3_5_moe", "Qwen3_5MoeForCausalLM"], ["gemma3n", "Gemma3nForCausalLM"], ["gemma4", "Gemma4ForCausalLM"], ["phi", "PhiForCausalLM"], ["phi3", "Phi3ForCausalLM"], ["mpt", "MptForCausalLM"], ["opt", "OPTForCausalLM"], ["mbart", "MBartForCausalLM"], ["mistral", "MistralForCausalLM"], ["mistral4", "Mistral4ForCausalLM"], ["ministral", "MinistralForCausalLM"], ["ministral3", "Ministral3ForCausalLM"], ["ernie4_5", "Ernie4_5ForCausalLM"], ["starcoder2", "Starcoder2ForCausalLM"], ["deepseek_v3", "DeepseekV3ForCausalLM"], ["falcon", "FalconForCausalLM"], ["falcon_h1", "FalconH1ForCausalLM"], ["nemotron_h", "NemotronHForCausalLM"], ["trocr", "TrOCRForCausalLM"], ["solar_open", "SolarOpenForCausalLM"], ["stablelm", "StableLmForCausalLM"], ["modernbert-decoder", "ModernBertDecoderForCausalLM"], ["hunyuan_v1_dense", "HunYuanDenseV1ForCausalLM"], ["youtu", "YoutuForCausalLM"], ["phi3_v", "Phi3VForCausalLM"]]);
  var gM = /* @__PURE__ */ new Map([["multi_modality", "MultiModalityCausalLM"]]);
  var Fb = /* @__PURE__ */ new Map([["bert", "BertForMaskedLM"], ["eurobert", "EuroBertForMaskedLM"], ["neobert", "NeoBertForMaskedLM"], ["modernbert", "ModernBertForMaskedLM"], ["roformer", "RoFormerForMaskedLM"], ["electra", "ElectraForMaskedLM"], ["esm", "EsmForMaskedLM"], ["convbert", "ConvBertForMaskedLM"], ["camembert", "CamembertForMaskedLM"], ["deberta", "DebertaForMaskedLM"], ["deberta-v2", "DebertaV2ForMaskedLM"], ["mpnet", "MPNetForMaskedLM"], ["albert", "AlbertForMaskedLM"], ["distilbert", "DistilBertForMaskedLM"], ["roberta", "RobertaForMaskedLM"], ["xlm", "XLMWithLMHeadModel"], ["xlm-roberta", "XLMRobertaForMaskedLM"], ["mobilebert", "MobileBertForMaskedLM"], ["squeezebert", "SqueezeBertForMaskedLM"]]);
  var Rb = /* @__PURE__ */ new Map([["bert", "BertForQuestionAnswering"], ["neobert", "NeoBertForQuestionAnswering"], ["roformer", "RoFormerForQuestionAnswering"], ["electra", "ElectraForQuestionAnswering"], ["convbert", "ConvBertForQuestionAnswering"], ["camembert", "CamembertForQuestionAnswering"], ["deberta", "DebertaForQuestionAnswering"], ["deberta-v2", "DebertaV2ForQuestionAnswering"], ["mpnet", "MPNetForQuestionAnswering"], ["albert", "AlbertForQuestionAnswering"], ["distilbert", "DistilBertForQuestionAnswering"], ["roberta", "RobertaForQuestionAnswering"], ["xlm", "XLMForQuestionAnswering"], ["xlm-roberta", "XLMRobertaForQuestionAnswering"], ["mobilebert", "MobileBertForQuestionAnswering"], ["squeezebert", "SqueezeBertForQuestionAnswering"]]);
  var Db = /* @__PURE__ */ new Map([["vision-encoder-decoder", "VisionEncoderDecoderModel"], ["idefics3", "Idefics3ForConditionalGeneration"], ["smolvlm", "SmolVLMForConditionalGeneration"]]);
  var qb = /* @__PURE__ */ new Map([["llava", "LlavaForConditionalGeneration"], ["llava_onevision", "LlavaOnevisionForConditionalGeneration"], ["moondream1", "Moondream1ForConditionalGeneration"], ["florence2", "Florence2ForConditionalGeneration"], ["qwen2_vl", "Qwen2VLForConditionalGeneration"], ["qwen2_5_vl", "Qwen2_5_VLForConditionalGeneration"], ["qwen3_vl", "Qwen3VLForConditionalGeneration"], ["qwen3_vl_moe", "Qwen3VLMoeForConditionalGeneration"], ["qwen3_5", "Qwen3_5ForConditionalGeneration"], ["qwen3_5_moe", "Qwen3_5MoeForConditionalGeneration"], ["lfm2_vl", "Lfm2VlForConditionalGeneration"], ["idefics3", "Idefics3ForConditionalGeneration"], ["smolvlm", "SmolVLMForConditionalGeneration"], ["paligemma", "PaliGemmaForConditionalGeneration"], ["llava_qwen2", "LlavaQwen2ForCausalLM"], ["gemma3", "Gemma3ForConditionalGeneration"], ["gemma3n", "Gemma3nForConditionalGeneration"], ["gemma4", "Gemma4ForConditionalGeneration"], ["mistral3", "Mistral3ForConditionalGeneration"], ["lighton_ocr", "LightOnOcrForConditionalGeneration"], ["glm_ocr", "GlmOcrForConditionalGeneration"]]);
  var jb = /* @__PURE__ */ new Map([["granite_speech", "GraniteSpeechForConditionalGeneration"], ["ultravox", "UltravoxModel"], ["voxtral", "VoxtralForConditionalGeneration"], ["voxtral_realtime", "VoxtralRealtimeForConditionalGeneration"]]);
  var xM = /* @__PURE__ */ new Map([["vision-encoder-decoder", "VisionEncoderDecoderModel"]]);
  var Bb = /* @__PURE__ */ new Map([["vit", "ViTForImageClassification"], ["ijepa", "IJepaForImageClassification"], ["pvt", "PvtForImageClassification"], ["vit_msn", "ViTMSNForImageClassification"], ["fastvit", "FastViTForImageClassification"], ["mobilevit", "MobileViTForImageClassification"], ["mobilevitv2", "MobileViTV2ForImageClassification"], ["beit", "BeitForImageClassification"], ["deit", "DeiTForImageClassification"], ["hiera", "HieraForImageClassification"], ["convnext", "ConvNextForImageClassification"], ["convnextv2", "ConvNextV2ForImageClassification"], ["dinov2", "Dinov2ForImageClassification"], ["dinov2_with_registers", "Dinov2WithRegistersForImageClassification"], ["resnet", "ResNetForImageClassification"], ["swin", "SwinForImageClassification"], ["segformer", "SegformerForImageClassification"], ["efficientnet", "EfficientNetForImageClassification"], ["mobilenet_v1", "MobileNetV1ForImageClassification"], ["mobilenet_v2", "MobileNetV2ForImageClassification"], ["mobilenet_v3", "MobileNetV3ForImageClassification"], ["mobilenet_v4", "MobileNetV4ForImageClassification"]]);
  var Ub = /* @__PURE__ */ new Map([["detr", "DetrForObjectDetection"], ["rt_detr", "RTDetrForObjectDetection"], ["rt_detr_v2", "RTDetrV2ForObjectDetection"], ["rf_detr", "RFDetrForObjectDetection"], ["d_fine", "DFineForObjectDetection"], ["table-transformer", "TableTransformerForObjectDetection"], ["yolos", "YolosForObjectDetection"]]);
  var Gb = /* @__PURE__ */ new Map([["owlvit", "OwlViTForObjectDetection"], ["owlv2", "Owlv2ForObjectDetection"], ["grounding-dino", "GroundingDinoForObjectDetection"]]);
  var br = /* @__PURE__ */ new Map([["detr", "DetrForSegmentation"], ["clipseg", "CLIPSegForImageSegmentation"]]);
  var Wb = /* @__PURE__ */ new Map([["segformer", "SegformerForSemanticSegmentation"], ["sapiens", "SapiensForSemanticSegmentation"], ["swin", "SwinForSemanticSegmentation"], ["mobilenet_v1", "MobileNetV1ForSemanticSegmentation"], ["mobilenet_v2", "MobileNetV2ForSemanticSegmentation"], ["mobilenet_v3", "MobileNetV3ForSemanticSegmentation"], ["mobilenet_v4", "MobileNetV4ForSemanticSegmentation"]]);
  var Vb = /* @__PURE__ */ new Map([["detr", "DetrForSegmentation"], ["maskformer", "MaskFormerForInstanceSegmentation"]]);
  var Hb = /* @__PURE__ */ new Map([["sam", "SamModel"], ["sam2", "Sam2Model"], ["edgetam", "EdgeTamModel"], ["sam3_tracker", "Sam3TrackerModel"]]);
  var Kb = /* @__PURE__ */ new Map([["wav2vec2", "Wav2Vec2ForCTC"], ["wav2vec2-bert", "Wav2Vec2BertForCTC"], ["unispeech", "UniSpeechForCTC"], ["unispeech-sat", "UniSpeechSatForCTC"], ["wavlm", "WavLMForCTC"], ["hubert", "HubertForCTC"], ["parakeet_ctc", "ParakeetForCTC"]]);
  var Xb = /* @__PURE__ */ new Map([["wav2vec2", "Wav2Vec2ForSequenceClassification"], ["wav2vec2-bert", "Wav2Vec2BertForSequenceClassification"], ["unispeech", "UniSpeechForSequenceClassification"], ["unispeech-sat", "UniSpeechSatForSequenceClassification"], ["wavlm", "WavLMForSequenceClassification"], ["hubert", "HubertForSequenceClassification"], ["audio-spectrogram-transformer", "ASTForAudioClassification"]]);
  var Qb = /* @__PURE__ */ new Map([["wavlm", "WavLMForXVector"]]);
  var Yb = /* @__PURE__ */ new Map([["unispeech-sat", "UniSpeechSatForAudioFrameClassification"], ["wavlm", "WavLMForAudioFrameClassification"], ["wav2vec2", "Wav2Vec2ForAudioFrameClassification"], ["pyannote", "PyAnnoteForAudioFrameClassification"]]);
  var Jb = /* @__PURE__ */ new Map([["vitmatte", "VitMatteForImageMatting"]]);
  var wM = /* @__PURE__ */ new Map([["patchtst", "PatchTSTForPrediction"], ["patchtsmixer", "PatchTSMixerForPrediction"]]);
  var Zb = /* @__PURE__ */ new Map([["swin2sr", "Swin2SRForImageSuperResolution"]]);
  var ek = /* @__PURE__ */ new Map([["chmv2", "CHMv2ForDepthEstimation"], ["dpt", "DPTForDepthEstimation"], ["depth_anything", "DepthAnythingForDepthEstimation"], ["glpn", "GLPNForDepthEstimation"], ["sapiens", "SapiensForDepthEstimation"], ["depth_pro", "DepthProForDepthEstimation"], ["metric3d", "Metric3DForDepthEstimation"], ["metric3dv2", "Metric3Dv2ForDepthEstimation"]]);
  var tk = /* @__PURE__ */ new Map([["sapiens", "SapiensForNormalEstimation"]]);
  var sk = /* @__PURE__ */ new Map([["vitpose", "VitPoseForPoseEstimation"]]);
  var rk = /* @__PURE__ */ new Map([["clip", "CLIPVisionModelWithProjection"], ["siglip", "SiglipVisionModel"], ["jina_clip", "JinaCLIPVisionModel"]]);
  var Ey = [[dM, N.EncoderOnly], [mM, N.EncoderDecoder], [hM, N.DecoderOnlyWithoutHead], [fM, N.AutoEncoder], [Pb, N.EncoderOnly], [Nb, N.EncoderOnly], [Lb, N.Seq2Seq], [zb, N.Seq2Seq], [$b, N.DecoderOnly], [gM, N.MultiModality], [Fb, N.EncoderOnly], [Rb, N.EncoderOnly], [Db, N.Vision2Seq], [qb, N.ImageTextToText], [jb, N.AudioTextToText], [Bb, N.EncoderOnly], [br, N.EncoderOnly], [Vb, N.EncoderOnly], [Wb, N.EncoderOnly], [Jb, N.EncoderOnly], [wM, N.EncoderOnly], [Zb, N.EncoderOnly], [ek, N.EncoderOnly], [tk, N.EncoderOnly], [sk, N.EncoderOnly], [Ub, N.EncoderOnly], [Gb, N.EncoderOnly], [Hb, N.MaskGeneration], [Kb, N.EncoderOnly], [Xb, N.EncoderOnly], [Tb, N.Seq2Seq], [Cb, N.EncoderOnly], [Qb, N.EncoderOnly], [Yb, N.EncoderOnly], [rk, N.EncoderOnly]];
  for (let [t6, e] of Ey) for (let s of t6.values()) {
    ct.set(s, e);
    let r = vi[s];
    ds.set(r, s), dl.set(s, r);
  }
  var yM = [["MusicgenForConditionalGeneration", Io, N.Musicgen], ["Phi3VForCausalLM", Go, N.Phi3V], ["CLIPTextModelWithProjection", wn, N.EncoderOnly], ["SiglipTextModel", oi, N.EncoderOnly], ["JinaCLIPTextModel", lo, N.EncoderOnly], ["ClapTextModelWithProjection", gn, N.EncoderOnly], ["ClapAudioModelWithProjection", xn, N.EncoderOnly], ["DacEncoderModel", In, N.EncoderOnly], ["DacDecoderModel", zn, N.EncoderOnly], ["MimiEncoderModel", go, N.EncoderOnly], ["MimiDecoderModel", xo, N.EncoderOnly], ["SnacEncoderModel", ai, N.EncoderOnly], ["SnacDecoderModel", li, N.EncoderOnly], ["Gemma3nForConditionalGeneration", Ht, N.ImageAudioTextToText], ["Gemma4ForConditionalGeneration", or, N.ImageAudioTextToText], ["SupertonicForConditionalGeneration", _i, N.Supertonic], ["ChatterboxModel", hn, N.Chatterbox], ["VoxtralRealtimeForConditionalGeneration", wi, N.VoxtralRealtime]];
  for (let [t6, e, s] of yM) ct.set(t6, s), ds.set(e, t6), dl.set(t6, e);
  var nk = /* @__PURE__ */ new Map([["modnet", br], ["birefnet", br], ["isnet", br], ["ben", br]]);
  for (let [t6, e] of nk.entries()) e.set(t6, "PreTrainedModel"), ct.set(t6, N.EncoderOnly), dl.set(t6, h);
  var ok = new Set(nk.keys());
  ct.set("PreTrainedModel", N.EncoderOnly);
  ds.set(h, "PreTrainedModel");
  var me = { MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES: Pb, MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING_NAMES: Nb, MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES: Tb, MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES: Cb, MODEL_FOR_MASKED_LM_MAPPING_NAMES: Fb, MODEL_FOR_QUESTION_ANSWERING_MAPPING_NAMES: Rb, MODEL_FOR_IMAGE_CLASSIFICATION_MAPPING_NAMES: Bb, MODEL_FOR_IMAGE_SEGMENTATION_MAPPING_NAMES: br, MODEL_FOR_SEMANTIC_SEGMENTATION_MAPPING_NAMES: Wb, MODEL_FOR_UNIVERSAL_SEGMENTATION_MAPPING_NAMES: Vb, MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES: Ub, MODEL_FOR_ZERO_SHOT_OBJECT_DETECTION_MAPPING_NAMES: Gb, MODEL_FOR_MASK_GENERATION_MAPPING_NAMES: Hb, MODEL_FOR_CTC_MAPPING_NAMES: Kb, MODEL_FOR_AUDIO_CLASSIFICATION_MAPPING_NAMES: Xb, MODEL_FOR_AUDIO_XVECTOR_MAPPING_NAMES: Qb, MODEL_FOR_AUDIO_FRAME_CLASSIFICATION_MAPPING_NAMES: Yb, MODEL_FOR_DOCUMENT_QUESTION_ANSWERING_MAPPING_NAMES: xM, MODEL_FOR_IMAGE_MATTING_MAPPING_NAMES: Jb, MODEL_FOR_IMAGE_TO_IMAGE_MAPPING_NAMES: Zb, MODEL_FOR_DEPTH_ESTIMATION_MAPPING_NAMES: ek, MODEL_FOR_NORMAL_ESTIMATION_MAPPING_NAMES: tk, MODEL_FOR_POSE_ESTIMATION_MAPPING_NAMES: sk, MODEL_FOR_IMAGE_FEATURE_EXTRACTION_MAPPING_NAMES: rk, MODEL_FOR_IMAGE_TEXT_TO_TEXT_MAPPING_NAMES: qb, MODEL_FOR_AUDIO_TEXT_TO_TEXT_MAPPING_NAMES: jb, MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES: Lb, MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES: zb, MODEL_FOR_CAUSAL_LM_MAPPING_NAMES: $b, MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES: Db };
  Ab(me);
  var _a36;
  var _e2 = (_a36 = class {
    static supports(e) {
      if (!this.MODEL_CLASS_MAPPINGS) return false;
      for (let s of this.MODEL_CLASS_MAPPINGS) if (s.has(e)) return true;
      return this.BASE_IF_FAIL;
    }
    static async from_pretrained(e, { progress_callback: s = null, config: r = null, cache_dir: n = null, local_files_only: o = false, revision: i = "main", model_file_name: a = null, subfolder: l = "onnx", device: c = null, dtype: p = null, use_external_data_format: u = null, session_options: _ = {} } = {}) {
      let d = { progress_callback: s, config: r, cache_dir: n, local_files_only: o, revision: i, model_file_name: a, subfolder: l, device: c, dtype: p, use_external_data_format: u, session_options: _ };
      if (d.config = await tt.from_pretrained(e, d), !this.MODEL_CLASS_MAPPINGS) throw new Error("`MODEL_CLASS_MAPPINGS` not implemented for this type of `AutoClass`: " + this.name);
      let { model_type: m } = d.config;
      for (let f of this.MODEL_CLASS_MAPPINGS) {
        let g = f.get(m);
        if (!g) {
          for (let x of f.values()) if (x[0] === m) {
            g = x;
            break;
          }
          if (!g) continue;
        }
        return await vi[g].from_pretrained(e, d);
      }
      if (this.BASE_IF_FAIL) return ok.has(m) || F.warn(`Unknown model class "${m}", attempting to construct from base class.`), await h.from_pretrained(e, d);
      throw Error(`Unsupported model type: ${m}`);
    }
  }, __publicField(_a36, "MODEL_CLASS_MAPPINGS", null), __publicField(_a36, "BASE_IF_FAIL", false), _a36);
  var _a37;
  var vt = (_a37 = class extends _e2 {
  }, __publicField(_a37, "MODEL_CLASS_MAPPINGS", Ey.map((e) => e[0])), __publicField(_a37, "BASE_IF_FAIL", true), _a37);
  var _a38;
  var Ei = (_a38 = class extends _e2 {
  }, __publicField(_a38, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_SEQUENCE_CLASSIFICATION_MAPPING_NAMES]), _a38);
  var _a39;
  var mc = (_a39 = class extends _e2 {
  }, __publicField(_a39, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_TOKEN_CLASSIFICATION_MAPPING_NAMES]), _a39);
  var _a40;
  var kr = (_a40 = class extends _e2 {
  }, __publicField(_a40, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_SEQ_TO_SEQ_CAUSAL_LM_MAPPING_NAMES]), _a40);
  var _a41;
  var fc = (_a41 = class extends _e2 {
  }, __publicField(_a41, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_SPEECH_SEQ_2_SEQ_MAPPING_NAMES]), _a41);
  var _a42;
  var hc = (_a42 = class extends _e2 {
  }, __publicField(_a42, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_TEXT_TO_SPECTROGRAM_MAPPING_NAMES]), _a42);
  var _a43;
  var gc = (_a43 = class extends _e2 {
  }, __publicField(_a43, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_TEXT_TO_WAVEFORM_MAPPING_NAMES]), _a43);
  var _a44;
  var xc = (_a44 = class extends _e2 {
  }, __publicField(_a44, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_CAUSAL_LM_MAPPING_NAMES]), _a44);
  var _a45;
  var wc = (_a45 = class extends _e2 {
  }, __publicField(_a45, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_MASKED_LM_MAPPING_NAMES]), _a45);
  var _a46;
  var yc = (_a46 = class extends _e2 {
  }, __publicField(_a46, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_QUESTION_ANSWERING_MAPPING_NAMES]), _a46);
  var _a47;
  var bc = (_a47 = class extends _e2 {
  }, __publicField(_a47, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_VISION_2_SEQ_MAPPING_NAMES]), _a47);
  var _a48;
  var kc = (_a48 = class extends _e2 {
  }, __publicField(_a48, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_IMAGE_CLASSIFICATION_MAPPING_NAMES]), _a48);
  var _a49;
  var Ai = (_a49 = class extends _e2 {
  }, __publicField(_a49, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_IMAGE_SEGMENTATION_MAPPING_NAMES]), _a49);
  var _a50;
  var Mi = (_a50 = class extends _e2 {
  }, __publicField(_a50, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_SEMANTIC_SEGMENTATION_MAPPING_NAMES]), _a50);
  var _a51;
  var Si = (_a51 = class extends _e2 {
  }, __publicField(_a51, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_UNIVERSAL_SEGMENTATION_MAPPING_NAMES]), _a51);
  var _a52;
  var vc = (_a52 = class extends _e2 {
  }, __publicField(_a52, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_OBJECT_DETECTION_MAPPING_NAMES]), _a52);
  var _a53;
  var Ec = (_a53 = class extends _e2 {
  }, __publicField(_a53, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_ZERO_SHOT_OBJECT_DETECTION_MAPPING_NAMES]), _a53);
  var _a54;
  var ik = (_a54 = class extends _e2 {
  }, __publicField(_a54, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_MASK_GENERATION_MAPPING_NAMES]), _a54);
  var _a55;
  var Ac = (_a55 = class extends _e2 {
  }, __publicField(_a55, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_CTC_MAPPING_NAMES]), _a55);
  var _a56;
  var Mc = (_a56 = class extends _e2 {
  }, __publicField(_a56, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_AUDIO_CLASSIFICATION_MAPPING_NAMES]), _a56);
  var _a57;
  var ak = (_a57 = class extends _e2 {
  }, __publicField(_a57, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_AUDIO_XVECTOR_MAPPING_NAMES]), _a57);
  var _a58;
  var lk = (_a58 = class extends _e2 {
  }, __publicField(_a58, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_AUDIO_FRAME_CLASSIFICATION_MAPPING_NAMES]), _a58);
  var _a59;
  var Sc = (_a59 = class extends _e2 {
  }, __publicField(_a59, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_DOCUMENT_QUESTION_ANSWERING_MAPPING_NAMES]), _a59);
  var _a60;
  var ck = (_a60 = class extends _e2 {
  }, __publicField(_a60, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_IMAGE_MATTING_MAPPING_NAMES]), _a60);
  var _a61;
  var Oc = (_a61 = class extends _e2 {
  }, __publicField(_a61, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_IMAGE_TO_IMAGE_MAPPING_NAMES]), _a61);
  var _a62;
  var Ic = (_a62 = class extends _e2 {
  }, __publicField(_a62, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_DEPTH_ESTIMATION_MAPPING_NAMES]), _a62);
  var _a63;
  var pk = (_a63 = class extends _e2 {
  }, __publicField(_a63, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_NORMAL_ESTIMATION_MAPPING_NAMES]), _a63);
  var _a64;
  var uk = (_a64 = class extends _e2 {
  }, __publicField(_a64, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_POSE_ESTIMATION_MAPPING_NAMES]), _a64);
  var _a65;
  var zc = (_a65 = class extends _e2 {
  }, __publicField(_a65, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_IMAGE_FEATURE_EXTRACTION_MAPPING_NAMES]), _a65);
  var _a66;
  var _k = (_a66 = class extends _e2 {
  }, __publicField(_a66, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_IMAGE_TEXT_TO_TEXT_MAPPING_NAMES]), _a66);
  var _a67;
  var dk = (_a67 = class extends _e2 {
  }, __publicField(_a67, "MODEL_CLASS_MAPPINGS", [me.MODEL_FOR_AUDIO_TEXT_TO_TEXT_MAPPING_NAMES]), _a67);
  async function Se(t6) {
    return Array.isArray(t6) || (t6 = [t6]), await Promise.all(t6.map((e) => Ee.read(e)));
  }
  async function Et(t6, e) {
    return Array.isArray(t6) || (t6 = [t6]), await Promise.all(t6.map((s) => typeof s == "string" || s instanceof URL ? ru(s, e) : s instanceof Float64Array ? new Float32Array(s) : s));
  }
  function Oi(t6, e) {
    e && (t6 = t6.map((i) => i | 0));
    let [s, r, n, o] = t6;
    return { xmin: s, ymin: r, xmax: n, ymax: o };
  }
  var Y = class extends xe {
    constructor({ task: e, model: s, tokenizer: r = null, processor: n = null }) {
      super(), this.task = e, this.model = s, this.tokenizer = r, this.processor = n;
    }
    async dispose() {
      await this.model.dispose();
    }
  };
  var Ii = class extends Y {
    async _call(e, { top_k: s = 1 } = {}) {
      let r = this.tokenizer(e, { padding: true, truncation: true }), n = await this.model(r), { problem_type: o, id2label: i } = this.model.config, a = o === "multi_label_classification" ? (c) => c.sigmoid() : (c) => new E("float32", fe(c.data), c.dims), l = [];
      for (let c of n.logits) {
        let p = a(c), u = await lt(p, s), _ = u[0].tolist(), m = u[1].tolist().map((f, g) => ({ label: i ? i[f] : `LABEL_${f}`, score: _[g] }));
        s === 1 ? l.push(...m) : l.push(m);
      }
      return Array.isArray(e) || s === 1 ? l : l[0];
    }
  };
  var zi = class extends Y {
    async _call(e, { ignore_labels: s = ["O"] } = {}) {
      let r = Array.isArray(e), n = this.tokenizer(r ? e : [e], { padding: true, truncation: true }), i = (await this.model(n)).logits, a = this.model.config.id2label, l = [];
      for (let c = 0; c < i.dims[0]; ++c) {
        let p = n.input_ids[c], u = i[c], _ = [];
        for (let d = 0; d < u.dims[0]; ++d) {
          let m = u[d], f = de(m.data)[1], g = a ? a[f] : `LABEL_${f}`;
          if (s.includes(g)) continue;
          let x = this.tokenizer.decode([p[d].item()], { skip_special_tokens: true });
          if (x === "") continue;
          let w = fe(m.data);
          _.push({ entity: g, score: w[f], index: d, word: x });
        }
        l.push(_);
      }
      return r ? l : l[0];
    }
  };
  var Ti = class extends Y {
    async _call(e, s, { top_k: r = 1 } = {}) {
      let n = this.tokenizer(e, { text_pair: s, padding: true, truncation: true }), o = Array.isArray(e), { start_logits: i, end_logits: a } = await this.model(n), l = n.input_ids.tolist(), c = n.attention_mask.tolist(), { all_special_ids: p, sep_token_id: u } = this.tokenizer, _ = [];
      for (let d = 0; d < i.dims[0]; ++d) {
        let m = l[d], f = m.findIndex((k) => k == u), g = i[d].tolist(), x = a[d].tolist();
        for (let k = 1; k < g.length; ++k) (c[d] == 0 || k <= f || p.findIndex((S) => S == m[k]) !== -1) && (g[k] = -1 / 0, x[k] = -1 / 0);
        let w = fe(g).map((k, S) => [k, S]), y = fe(x).map((k, S) => [k, S]);
        w[0][0] = 0, y[0][0] = 0;
        let b = qy(w, y).filter((k) => k[0][1] <= k[1][1]).map((k) => [k[0][1], k[1][1], k[0][0] * k[1][0]]).sort((k, S) => S[2] - k[2]), v = [];
        for (let k = 0; k < Math.min(b.length, r); ++k) {
          let [S, I, $] = b[k], C = m.slice(S, I + 1), q = this.tokenizer.decode(C, { skip_special_tokens: true });
          v.push({ answer: q, score: $ });
        }
        r === 1 ? _.push(...v) : _.push(v);
      }
      return o ? _ : _[0];
    }
  };
  var Ci = class extends Y {
    async _call(e, { top_k: s = 5 } = {}) {
      let { mask_token_id: r, mask_token: n } = this.tokenizer, o = this.tokenizer(e, { padding: true, truncation: true }), { logits: i } = await this.model(o), a = [], l = o.input_ids.tolist();
      for (let c = 0; c < l.length; ++c) {
        let p = l[c], u = p.findIndex((g) => g == r);
        if (u === -1) throw Error(`Mask token (${n}) not found in text.`);
        let _ = i[c][u], d = await lt(new E("float32", fe(_.data), _.dims), s), m = d[0].tolist(), f = d[1].tolist();
        a.push(f.map((g, x) => {
          let w = p.slice();
          return w[u] = g, { score: m[x], token: Number(g), token_str: this.tokenizer.decode([g]), sequence: this.tokenizer.decode(w, { skip_special_tokens: true }) };
        }));
      }
      return Array.isArray(e) ? a : a[0];
    }
  };
  var At = class extends Y {
    constructor() {
      super(...arguments);
      __publicField(this, "_key", "generated_text");
    }
    async _call(e, s = {}) {
      Array.isArray(e) || (e = [e]), this.model.config.prefix && (e = e.map((l) => this.model.config.prefix + l));
      let r = this.model.config.task_specific_params;
      r && r[this.task] && r[this.task].prefix && (e = e.map((l) => r[this.task].prefix + l));
      let n = this.tokenizer, o = { padding: true, truncation: true }, i;
      this.task === "translation" && "_build_translation_inputs" in n ? i = n._build_translation_inputs(e, o, s) : i = n(e, o);
      let a = await this.model.generate({ ...i, ...s });
      return n.batch_decode(a, { skip_special_tokens: true }).map((l) => ({ [this._key]: l }));
    }
  };
  var Pi = class extends At {
    constructor() {
      super(...arguments);
      __publicField(this, "_key", "summary_text");
    }
  };
  var Ni = class extends At {
    constructor() {
      super(...arguments);
      __publicField(this, "_key", "translation_text");
    }
  };
  function mk(t6) {
    return Array.isArray(t6) && t6.every((e) => "role" in e && "content" in e);
  }
  var Li = class extends Y {
    async _call(e, s = {}) {
      let r = false, n = false, o = s.add_special_tokens ?? (this.tokenizer.add_bos_token || this.tokenizer.add_eos_token) ?? false, i = s.tokenizer_encode_kwargs, a;
      if (typeof e == "string") a = e = [e];
      else if (Array.isArray(e) && e.every((m) => typeof m == "string")) r = true, a = e;
      else {
        if (mk(e)) e = [e];
        else if (Array.isArray(e) && e.every(mk)) r = true;
        else throw new Error("Input must be a string, an array of strings, a Chat, or an array of Chats");
        n = true, a = e.map((m) => this.tokenizer.apply_chat_template(m, { tokenize: false, add_generation_prompt: true, ...i })), o = false, i = void 0;
      }
      let l = n ? false : s.return_full_text ?? true;
      this.tokenizer.padding_side = "left";
      let c = this.tokenizer(a, { add_special_tokens: o, padding: true, truncation: true, ...i }), p = await this.model.generate({ ...c, ...s }), u = this.tokenizer.batch_decode(p, { skip_special_tokens: true }), _;
      !l && c.input_ids.dims.at(-1) > 0 && (_ = this.tokenizer.batch_decode(c.input_ids, { skip_special_tokens: true }).map((m) => m.length));
      let d = Array.from({ length: e.length }, (m) => []);
      for (let m = 0; m < u.length; ++m) {
        let f = Math.floor(m / p.dims[0] * e.length);
        _ && (u[m] = u[m].slice(_[f])), d[f].push({ generated_text: n ? [...e[f], { role: "assistant", content: u[m] }] : u[m] });
      }
      return !r && d.length === 1 ? d[0] : d;
    }
  };
  var $i = class extends Y {
    constructor(e) {
      super(e), this.label2id = Object.fromEntries(Object.entries(this.model.config.label2id).map(([s, r]) => [s.toLowerCase(), r])), this.entailment_id = this.label2id.entailment, this.entailment_id === void 0 && (F.warn("Could not find 'entailment' in label2id mapping. Using 2 as entailment_id."), this.entailment_id = 2), this.contradiction_id = this.label2id.contradiction ?? this.label2id.not_entailment, this.contradiction_id === void 0 && (F.warn("Could not find 'contradiction' in label2id mapping. Using 0 as contradiction_id."), this.contradiction_id = 0);
    }
    async _call(e, s, { hypothesis_template: r = "This example is {}.", multi_label: n = false } = {}) {
      let o = Array.isArray(e);
      o || (e = [e]), Array.isArray(s) || (s = [s]);
      let i = s.map((c) => r.replace("{}", c)), a = n || s.length === 1, l = [];
      for (let c of e) {
        let p = [];
        for (let d of i) {
          let m = this.tokenizer(c, { text_pair: d, padding: true, truncation: true }), f = await this.model(m);
          a ? p.push([f.logits.data[this.contradiction_id], f.logits.data[this.entailment_id]]) : p.push(f.logits.data[this.entailment_id]);
        }
        let _ = (a ? p.map((d) => fe(d)[1]) : fe(p)).map((d, m) => [d, m]).sort((d, m) => m[0] - d[0]);
        l.push({ sequence: c, labels: _.map((d) => s[d[1]]), scores: _.map((d) => d[0]) });
      }
      return o ? l : l[0];
    }
  };
  var Fi = class extends Y {
    async _call(e, { top_k: s = 5 } = {}) {
      let r = this.processor.feature_extractor.config.sampling_rate, n = await Et(e, r), o = this.model.config.id2label, i = [];
      for (let a of n) {
        let l = await this.processor(a), p = (await this.model(l)).logits[0], u = await lt(new E("float32", fe(p.data), p.dims), s), _ = u[0].tolist(), m = u[1].tolist().map((f, g) => ({ label: o ? o[f] : `LABEL_${f}`, score: _[g] }));
        i.push(m);
      }
      return Array.isArray(e) ? i : i[0];
    }
  };
  var Ri = class extends Y {
    async _call(e, s, { hypothesis_template: r = "This is a sound of {}." } = {}) {
      let n = !Array.isArray(e);
      n && (e = [e]);
      let o = s.map((p) => r.replace("{}", p)), i = this.tokenizer(o, { padding: true, truncation: true }), a = this.processor.feature_extractor.config.sampling_rate, l = await Et(e, a), c = [];
      for (let p of l) {
        let u = await this.processor(p), _ = await this.model({ ...i, ...u }), d = fe(_.logits_per_audio.data);
        c.push([...d].map((m, f) => ({ score: m, label: s[f] })));
      }
      return n ? c[0] : c;
    }
  };
  var Di = class extends Y {
    async _call(e, s = {}) {
      switch (this.model.config.model_type) {
        case "whisper":
        case "lite-whisper":
          return this._call_whisper(e, s);
        case "wav2vec2":
        case "wav2vec2-bert":
        case "unispeech":
        case "unispeech-sat":
        case "hubert":
        case "parakeet_ctc":
          return this._call_wav2vec2(e, s);
        case "moonshine":
          return this._call_moonshine(e, s);
        case "cohere_asr":
          return this._call_cohere_asr(e, s);
        default:
          throw new Error(`AutomaticSpeechRecognitionPipeline does not support model type '${this.model.config.model_type}'.`);
      }
    }
    async _call_wav2vec2(e, s) {
      s.language && F.warn('`language` parameter is not yet supported for `wav2vec2` models, defaulting to "English".'), s.task && F.warn('`task` parameter is not yet supported for `wav2vec2` models, defaulting to "transcribe".');
      let r = !Array.isArray(e), n = r ? [e] : e, o = this.processor.feature_extractor.config.sampling_rate, i = await Et(n, o), a = [];
      for (let l of i) {
        let c = await this.processor(l), u = (await this.model(c)).logits[0], _ = [];
        for (let m of u) _.push(de(m.data)[1]);
        let d = this.tokenizer.decode(_, { skip_special_tokens: true }).trim();
        a.push({ text: d });
      }
      return r ? a[0] : a;
    }
    async _call_whisper(e, s) {
      let r = s.return_timestamps ?? false, n = s.chunk_length_s ?? 0, o = s.force_full_sequences ?? false, i = s.stride_length_s ?? null, a = { ...s };
      r === "word" && (a.return_token_timestamps = true, a.return_timestamps = true);
      let l = !Array.isArray(e), c = l ? [e] : e, p = this.processor.feature_extractor.config, u = p.chunk_length / this.model.config.max_source_positions, _ = p.hop_length, d = p.sampling_rate, m = await Et(c, d), f = [];
      for (let g of m) {
        let x = [];
        if (n > 0) {
          if (i === null) i = n / 6;
          else if (n <= i) throw Error("`chunk_length_s` must be larger than `stride_length_s`.");
          let b = d * n, v = d * i, k = b - 2 * v, S = 0;
          for (; ; ) {
            let I = S + b, $ = g.subarray(S, I), C = await this.processor($), q = S === 0, D = I >= g.length;
            if (x.push({ stride: [$.length, q ? 0 : v, D ? 0 : v], input_features: C.input_features, is_last: D }), D) break;
            S += k;
          }
        } else x = [{ stride: [g.length, 0, 0], input_features: (await this.processor(g)).input_features, is_last: true }];
        for (let b of x) {
          a.num_frames = Math.floor(b.stride[0] / _);
          let v = await this.model.generate({ inputs: b.input_features, ...a });
          if (r === "word") {
            let k = v.sequences.tolist()[0], S = v.token_timestamps.tolist()[0], I = this.tokenizer.timestamp_begin, $ = Math.max(k.findIndex((C) => Number(C) >= I), 0);
            b.tokens = k.slice($), b.token_timestamps = S.slice($).map((C) => os(C, 2));
          } else b.tokens = v[0].tolist();
          b.stride = b.stride.map((k) => k / d);
        }
        let [w, y] = this.tokenizer._decode_asr(x, { time_precision: u, return_timestamps: r, force_full_sequences: o });
        f.push({ text: w, ...y });
      }
      return l ? f[0] : f;
    }
    async _call_moonshine(e, s) {
      let r = !Array.isArray(e), n = r ? [e] : e, o = this.processor.feature_extractor.config.sampling_rate, i = await Et(n, o), a = [];
      for (let l of i) {
        let c = await this.processor(l), p = Math.floor(l.length / o) * 6, u = await this.model.generate({ max_new_tokens: p, ...s, ...c }), _ = this.processor.batch_decode(u, { skip_special_tokens: true })[0];
        a.push({ text: _ });
      }
      return r ? a[0] : a;
    }
    async _call_cohere_asr(e, s) {
      let r = !Array.isArray(e), n = r ? [e] : e, o = this.processor.feature_extractor, i = o.config.sampling_rate, a = await Et(n, i), l = s.language ?? "en", c = this.processor.get_decoder_prompt_ids(l), p = [];
      for (let u of a) {
        let _ = o.split_audio(u), d = [];
        for (let f of _) {
          let g = await this.processor(f), x = await this.model.generate({ ...g, decoder_input_ids: c, ...s }), w = this.tokenizer.decode(x[0].tolist(), { skip_special_tokens: true }).trim();
          d.push(w);
        }
        let m = this.processor.constructor.join_chunks(d, l);
        p.push({ text: m });
      }
      return r ? p[0] : p;
    }
  };
  var qi = class extends Y {
    constructor(e) {
      super(e);
      __publicField(this, "DEFAULT_VOCODER_ID", "Xenova/speecht5_hifigan");
      this.vocoder = e.vocoder ?? null;
    }
    async _prepare_speaker_embeddings(e, s) {
      if ((typeof e == "string" || e instanceof URL) && (e = new Float32Array(await (await J.fetch(e)).arrayBuffer())), e instanceof Float32Array) e = new E("float32", e, [e.length]);
      else if (!(e instanceof E)) throw new Error("Speaker embeddings must be a `Tensor`, `Float32Array`, `string`, or `URL`.");
      if (s > 1) {
        if (e.dims[0] === 1) e = e.repeat(s, 1);
        else if (e.dims[0] !== s) throw new Error(`Expected speaker embeddings batch size to be 1 or ${s}, but got ${e.dims[0]}.`);
      }
      return e;
    }
    _postprocess_waveform(e, s, r, n = null) {
      let o = s.data, [i, a] = s.dims, l = n ? n.data : null, c = [];
      for (let p = 0; p < i; ++p) {
        let u = l ? Math.min(Math.ceil(l[p]), a) : a, _ = p * a;
        c.push(new Ur(o.slice(_, _ + u), r));
      }
      return Array.isArray(e) ? c : c[0];
    }
    async _call(e, s) {
      return this.processor ? this._call_text_to_spectrogram(e, s) : this.model.config.model_type === "supertonic" ? this._call_supertonic(e, s) : this._call_text_to_waveform(e);
    }
    async _call_supertonic(e, { speaker_embeddings: s, num_inference_steps: r, speed: n }) {
      if (!s) throw new Error("Speaker embeddings must be provided for Supertonic models.");
      let { sampling_rate: o, style_dim: i } = this.model.config, a = this.tokenizer(e, { padding: true, truncation: true }), l = a.input_ids.dims[0];
      s = await this._prepare_speaker_embeddings(s, l), s = s.view(l, -1, i);
      let { waveform: c, durations: p } = await this.model.generate_speech({ ...a, style: s, num_inference_steps: r, speed: n });
      return this._postprocess_waveform(e, c, o, p);
    }
    async _call_text_to_waveform(e) {
      let s = this.tokenizer(e, { padding: true, truncation: true }), { waveform: r } = await this.model(s), n = this.model.config.sampling_rate;
      return this._postprocess_waveform(e, r, n);
    }
    async _call_text_to_spectrogram(e, { speaker_embeddings: s }) {
      this.vocoder || (F.info("No vocoder specified, using default HifiGan vocoder."), this.vocoder = await vt.from_pretrained(this.DEFAULT_VOCODER_ID, { dtype: "fp32" }));
      let { input_ids: r } = this.tokenizer(e, { padding: true, truncation: true }), n = r.dims[0];
      s = await this._prepare_speaker_embeddings(s, n), s = s.view(n, -1);
      let { waveform: o } = await this.model.generate_speech(r, s, { vocoder: this.vocoder }), i = this.processor.feature_extractor.config.sampling_rate;
      return this._postprocess_waveform(e, o, i);
    }
  };
  var ji = class extends Y {
    async _call(e, s = {}) {
      let r = Array.isArray(e), n = await Se(e), { pixel_values: o } = await this.processor(n), i = [];
      for (let a of o) {
        a.dims = [1, ...a.dims];
        let l = await this.model.generate({ inputs: a, ...s }), c = this.tokenizer.batch_decode(l, { skip_special_tokens: true }).map((p) => ({ generated_text: p.trim() }));
        i.push(c);
      }
      return r ? i : i[0];
    }
  };
  var Bi = class extends Y {
    async _call(e, { top_k: s = 5 } = {}) {
      let r = await Se(e), { pixel_values: n } = await this.processor(r), o = await this.model({ pixel_values: n }), { id2label: i } = this.model.config, a = [];
      for (let l of o.logits) {
        let c = await lt(new E("float32", fe(l.data), l.dims), s), p = c[0].tolist(), _ = c[1].tolist().map((d, m) => ({ label: i ? i[d] : `LABEL_${d}`, score: p[m] }));
        a.push(_);
      }
      return Array.isArray(e) ? a : a[0];
    }
  };
  var fk = { panoptic: "post_process_panoptic_segmentation", instance: "post_process_instance_segmentation", semantic: "post_process_semantic_segmentation" };
  var As = class extends Y {
    async _call(e, { threshold: s = 0.5, mask_threshold: r = 0.5, overlap_mask_area_threshold: n = 0.8, label_ids_to_fuse: o = null, target_sizes: i = null, subtask: a = null } = {}) {
      if (Array.isArray(e) && e.length !== 1) throw Error("Image segmentation pipeline currently only supports a batch size of 1.");
      let c = await Se(e), p = c.map((w) => [w.height, w.width]), u = await this.processor(c), { inputNames: _, outputNames: d } = this.model.sessions.model;
      if (!_.includes("pixel_values")) {
        if (_.length !== 1) throw Error(`Expected a single input name, but got ${_.length} inputs: ${_}.`);
        let w = _[0];
        if (w in u) throw Error(`Input name ${w} already exists in the inputs.`);
        u[w] = u.pixel_values;
      }
      let m = await this.model(u), f = null;
      if (a !== null) f = fk[a];
      else if (this.processor.image_processor) {
        for (let [w, y] of Object.entries(fk)) if (y in this.processor.image_processor) {
          f = this.processor.image_processor[y].bind(this.processor.image_processor), a = w;
          break;
        }
      }
      let g = this.model.config.id2label, x = [];
      if (a) if (a === "panoptic" || a === "instance") {
        let w = f(m, s, r, n, o, i ?? p)[0], y = w.segmentation;
        for (let b of w.segments_info) {
          let v = new Uint8ClampedArray(y.data.length);
          for (let S = 0; S < y.data.length; ++S) y.data[S] === b.id && (v[S] = 255);
          let k = new Ee(v, y.dims[1], y.dims[0], 1);
          x.push({ score: b.score, label: g[b.label_id], mask: k });
        }
      } else if (a === "semantic") {
        let { segmentation: w, labels: y } = f(m, i ?? p)[0];
        for (let b of y) {
          let v = new Uint8ClampedArray(w.data.length);
          for (let S = 0; S < w.data.length; ++S) w.data[S] === b && (v[S] = 255);
          let k = new Ee(v, w.dims[1], w.dims[0], 1);
          x.push({ score: null, label: g[b], mask: k });
        }
      } else throw Error(`Subtask ${a} not supported.`);
      else {
        let y = m[d[0]];
        for (let b = 0; b < p.length; ++b) {
          let v = p[b], k = y[b];
          k.data.some((I) => I < -1e-5 || I > 1 + 1e-5) && k.sigmoid_();
          let S = await Ee.fromTensor(k.mul_(255).to("uint8")).resize(v[1], v[0]);
          x.push({ label: null, score: null, mask: S });
        }
      }
      return x;
    }
  };
  var Ui = class extends As {
    async _call(e, s = {}) {
      let r = await Se(e), n = await super._call(e, s), o = r.map((i, a) => {
        let l = i.clone();
        return l.putAlpha(n[a].mask), l;
      });
      return Array.isArray(e) ? o : o[0];
    }
  };
  var Gi = class extends Y {
    async _call(e, s, { hypothesis_template: r = "This is a photo of {}" } = {}) {
      let n = Array.isArray(e), o = await Se(e), i = s.map((_) => r.replace("{}", _)), a = this.tokenizer(i, { padding: this.model.config.model_type === "siglip" ? "max_length" : true, truncation: true }), { pixel_values: l } = await this.processor(o), c = await this.model({ ...a, pixel_values: l }), p = this.model.config.model_type === "siglip" ? (_) => _.sigmoid().data : (_) => fe(_.data), u = [];
      for (let _ of c.logits_per_image) {
        let m = [...p(_)].map((f, g) => ({ score: f, label: s[g] }));
        m.sort((f, g) => g.score - f.score), u.push(m);
      }
      return n ? u : u[0];
    }
  };
  var Wi = class extends Y {
    async _call(e, { threshold: s = 0.9, percentage: r = false } = {}) {
      let n = Array.isArray(e);
      if (n && e.length !== 1) throw Error("Object detection pipeline currently only supports a batch size of 1.");
      let o = await Se(e), i = r ? null : o.map((d) => [d.height, d.width]), { pixel_values: a, pixel_mask: l } = await this.processor(o), c = await this.model({ pixel_values: a, pixel_mask: l }), p = this.processor.image_processor.post_process_object_detection(c, s, i), { id2label: u } = this.model.config, _ = p.map((d) => d.boxes.map((m, f) => ({ score: d.scores[f], label: u[d.classes[f]], box: Oi(m, !r) })));
      return n ? _ : _[0];
    }
  };
  var Vi = class extends Y {
    async _call(e, s, { threshold: r = 0.1, top_k: n = null, percentage: o = false } = {}) {
      let i = Array.isArray(e), a = await Se(e), l = this.tokenizer(s, { padding: true, truncation: true }), c = await this.processor(a), p = [];
      for (let u = 0; u < a.length; ++u) {
        let _ = a[u], d = o ? null : [[_.height, _.width]], m = c.pixel_values[u].unsqueeze_(0), f = await this.model({ ...l, pixel_values: m }), g;
        if ("post_process_grounded_object_detection" in this.processor) {
          let x = this.processor.post_process_grounded_object_detection(f, l.input_ids, { box_threshold: r, text_threshold: r, target_sizes: d })[0];
          g = x.boxes.map((w, y) => ({ score: x.scores[y], label: x.labels[y], box: Oi(w, !o) }));
        } else {
          let x = this.processor.image_processor.post_process_object_detection(f, r, d, true)[0];
          g = x.boxes.map((w, y) => ({ score: x.scores[y], label: s[x.classes[y]], box: Oi(w, !o) }));
        }
        g.sort((x, w) => w.score - x.score), n !== null && (g = g.slice(0, n)), p.push(g);
      }
      return i ? p : p[0];
    }
  };
  var Hi = class extends Y {
    async _call(e, s, r = {}) {
      if (Array.isArray(e)) {
        if (e.length !== 1) throw Error("Document Question Answering pipeline currently only supports a batch size of 1.");
        e = e[0];
      }
      let n = (await Se(e))[0], { pixel_values: o } = await this.processor(n), i = `<s_docvqa><s_question>${s}</s_question><s_answer>`, a = this.tokenizer(i, { add_special_tokens: false, padding: true, truncation: true }).input_ids, l = await this.model.generate({ inputs: o, max_length: this.model.config.decoder.max_position_embeddings, decoder_input_ids: a, ...r }), p = this.tokenizer.batch_decode(l)[0].match(/<s_answer>(.*?)<\/s_answer>/), u = null;
      return p && p.length >= 2 && (u = p[1].trim()), [{ answer: u }];
    }
  };
  var Ki = class extends Y {
    async _call(e) {
      let s = await Se(e), r = await this.processor(s), n = await this.model(r), o = [];
      for (let i of n.reconstruction) {
        let a = i.squeeze().clamp_(0, 1).mul_(255).round_().to("uint8");
        o.push(Ee.fromTensor(a));
      }
      return Array.isArray(e) ? o : o[0];
    }
  };
  var Xi = class extends Y {
    async _call(e) {
      let s = await Se(e), r = await this.processor(s), { predicted_depth: n } = await this.model(r), o = [];
      for (let i = 0; i < s.length; ++i) {
        let a = n[i], [l, c] = a.dims.slice(-2), [p, u] = s[i].size, _ = (await je(a.view(1, 1, l, c), { size: [u, p], mode: "bilinear" })).view(u, p), d = _.min().item(), m = _.max().item(), f = _.sub(d).div_(m - d).mul_(255).to("uint8").unsqueeze(0), g = Ee.fromTensor(f);
        o.push({ predicted_depth: _, depth: g });
      }
      return Array.isArray(e) ? o : o[0];
    }
  };
  var Qi = class extends Y {
    async _call(e, { pooling: s = "none", normalize: r = false, quantize: n = false, precision: o = "binary" } = {}) {
      let i = this.tokenizer(e, { padding: true, truncation: true }), a = await this.model(i), l = a.last_hidden_state ?? a.logits ?? a.token_embeddings;
      switch (s) {
        case "none":
          break;
        case "mean":
          l = Y0(l, i.attention_mask);
          break;
        case "first_token":
        case "cls":
          l = l.slice(null, 0);
          break;
        case "last_token":
        case "eos":
          l = l.slice(null, -1);
          break;
        default:
          throw Error(`Pooling method '${s}' not supported.`);
      }
      return r && (l = l.normalize(2, -1)), n && (l = Z0(l, o)), l;
    }
  };
  var Yi = class extends Y {
    async _call(e, { pool: s = null } = {}) {
      let r = await Se(e), { pixel_values: n } = await this.processor(r), o = await this.model({ pixel_values: n }), i;
      if (s) {
        if (!("pooler_output" in o)) throw Error("No pooled output was returned. Make sure the model has a 'pooler' layer when using the 'pool' option.");
        i = o.pooler_output;
      } else i = o.last_hidden_state ?? o.logits ?? o.image_embeds;
      return i;
    }
  };
  var vr = Object.freeze({ "text-classification": { pipeline: Ii, model: Ei, default: { model: "Xenova/distilbert-base-uncased-finetuned-sst-2-english" }, type: "text" }, "token-classification": { pipeline: zi, model: mc, default: { model: "Xenova/bert-base-multilingual-cased-ner-hrl" }, type: "text" }, "question-answering": { pipeline: Ti, model: yc, default: { model: "Xenova/distilbert-base-cased-distilled-squad" }, type: "text" }, "fill-mask": { pipeline: Ci, model: wc, default: { model: "onnx-community/ettin-encoder-32m-ONNX", dtype: "fp32" }, type: "text" }, summarization: { pipeline: Pi, model: kr, default: { model: "Xenova/distilbart-cnn-6-6" }, type: "text" }, translation: { pipeline: Ni, model: kr, default: { model: "Xenova/t5-small" }, type: "text" }, "text2text-generation": { pipeline: At, model: kr, default: { model: "Xenova/flan-t5-small" }, type: "text" }, "text-generation": { pipeline: Li, model: xc, default: { model: "onnx-community/Qwen3-0.6B-ONNX", dtype: "q4" }, type: "text" }, "zero-shot-classification": { pipeline: $i, model: Ei, default: { model: "Xenova/distilbert-base-uncased-mnli" }, type: "text" }, "audio-classification": { pipeline: Fi, model: Mc, default: { model: "Xenova/wav2vec2-base-superb-ks" }, type: "audio" }, "zero-shot-audio-classification": { pipeline: Ri, model: vt, default: { model: "Xenova/clap-htsat-unfused" }, type: "multimodal" }, "automatic-speech-recognition": { pipeline: Di, model: [fc, Ac], default: { model: "Xenova/whisper-tiny.en" }, type: "multimodal" }, "text-to-audio": { pipeline: qi, model: [gc, hc], default: { model: "onnx-community/Supertonic-TTS-ONNX", dtype: "fp32" }, type: "text" }, "image-to-text": { pipeline: ji, model: bc, default: { model: "Xenova/vit-gpt2-image-captioning" }, type: "multimodal" }, "image-classification": { pipeline: Bi, model: kc, default: { model: "Xenova/vit-base-patch16-224" }, type: "multimodal" }, "image-segmentation": { pipeline: As, model: [Ai, Mi, Si], default: { model: "Xenova/detr-resnet-50-panoptic" }, type: "multimodal" }, "background-removal": { pipeline: Ui, model: [Ai, Mi, Si], default: { model: "Xenova/modnet" }, type: "image" }, "zero-shot-image-classification": { pipeline: Gi, model: vt, default: { model: "Xenova/clip-vit-base-patch32" }, type: "multimodal" }, "object-detection": { pipeline: Wi, model: vc, default: { model: "Xenova/detr-resnet-50" }, type: "multimodal" }, "zero-shot-object-detection": { pipeline: Vi, model: Ec, default: { model: "Xenova/owlvit-base-patch32" }, type: "multimodal" }, "document-question-answering": { pipeline: Hi, model: Sc, default: { model: "Xenova/donut-base-finetuned-docvqa" }, type: "multimodal" }, "image-to-image": { pipeline: Ki, model: Oc, default: { model: "Xenova/swin2SR-classical-sr-x2-64" }, type: "image" }, "depth-estimation": { pipeline: Xi, model: Ic, default: { model: "onnx-community/depth-anything-v2-small" }, type: "image" }, "feature-extraction": { pipeline: Qi, model: vt, default: { model: "onnx-community/all-MiniLM-L6-v2-ONNX", dtype: "fp32" }, type: "text" }, "image-feature-extraction": { pipeline: Yi, model: [zc, vt], default: { model: "onnx-community/dinov3-vits16-pretrain-lvd1689m-ONNX", dtype: "fp32" }, type: "image" } });
  var Tc = Object.freeze({ "sentiment-analysis": "text-classification", ner: "token-classification", asr: "automatic-speech-recognition", "text-to-speech": "text-to-audio", embeddings: "feature-extraction" });
  async function Cc(t6) {
    if (!t6) throw new Error("modelId is required");
    return (await We(t6, kt, {})).exists ? [kt] : [];
  }
  async function Mt(t6, { config: e = null, dtype: s = null, device: r = null, model_file_name: n = null, include_tokenizer: o = true, include_processor: i = true } = {}) {
    let a = await Ys(t6, { config: e, dtype: s, device: r, model_file_name: n });
    if (o) {
      let l = await $s(t6);
      a.push(...l);
    }
    if (i) {
      let l = await Cc(t6);
      a.push(...l);
    }
    return a;
  }
  async function St(t6, e, s = {}) {
    t6 = Tc[t6] ?? t6;
    let r = vr[t6];
    if (!r) throw new Error(`Unsupported pipeline task: ${t6}. Must be one of [${Object.keys(vr).join(", ")}]`);
    let { type: n } = r, a = await Mt(e, { ...s, include_tokenizer: n !== "audio" && n !== "image", include_processor: n !== "text" });
    if (t6 === "text-generation") {
      let l = await on(e, s), c = Qs(l), p = G_(c);
      if (p) {
        let u = Object.values(p).map((_) => `onnx/${_}`);
        return a.filter((_) => !_.startsWith("onnx/") || u.some((d) => _.startsWith(d)));
      }
    }
    return a;
  }
  async function HY(t6, e = null, { progress_callback: s = null, config: r = null, cache_dir: n = null, local_files_only: o = false, revision: i = "main", device: a = null, dtype: l = null, subfolder: c = "onnx", use_external_data_format: p = null, model_file_name: u = null, session_options: _ = {} } = {}) {
    t6 = Tc[t6] ?? t6;
    let d = vr[t6.split("_", 1)[0]];
    if (!d) throw Error(`Unsupported pipeline: ${t6}. Must be one of [${Object.keys(vr)}]`);
    e || (e = d.default.model, F.info(`No model specified. Using default model: "${e}".`), !l && d.default.dtype && (l = d.default.dtype));
    let m = await St(t6, e, { device: a, dtype: l }), f = {};
    s && (await Promise.all(m.map(async (q) => We(e, q)))).forEach((q, D) => {
      q.exists && (f[m[D]] = { loaded: 0, total: q.size ?? 0 });
    });
    let g = { progress_callback: s ? new ts(s, f) : void 0, config: r, cache_dir: n, local_files_only: o, revision: i, device: a, dtype: l, subfolder: c, use_external_data_format: p, model_file_name: u, session_options: _ }, x = m.includes("tokenizer.json"), w = m.includes("preprocessor_config.json"), y = d.model, b;
    if (Array.isArray(y)) {
      let C = r ?? await tt.from_pretrained(e, g), { model_type: q } = C, D = y.find((B) => B.supports(q));
      if (!D) throw Error(`Unsupported model type "${q}" for task "${t6}". None of the candidate model classes support this type.`);
      b = D.from_pretrained(e, { ...g, config: C });
    } else b = y.from_pretrained(e, g);
    let [v, k, S] = await Promise.all([x ? W.from_pretrained(e, g) : null, w ? Qa.from_pretrained(e, g) : null, b]), I = { task: t6, model: S };
    v && (I.tokenizer = v), k && (I.processor = k), _t(s, { status: "ready", task: t6, model: e });
    let $ = d.pipeline;
    return new $(I);
  }
  var hk = K.IS_PROCESS_AVAILABLE ? (t6) => process.stdout.write(t6) : (t6) => console.log(t6);
  var vM = Object.keys(Lt);

  // engine/plugins/vn_alive_bg/depth-worker.js
  var depthEstimator = null;
  var depthEstimatorError = null;
  var pluginBaseUrl = "";
  function normalizeBaseUrl(baseUrl) {
    return String(baseUrl || "").replace(/\/+$/, "");
  }
  function getModelPath() {
    return "depth-anything-v2-small";
  }
  function getLocalWasmPath() {
    return `${pluginBaseUrl}/vendor/wasm/ort-wasm-simd-threaded.jsep.wasm`;
  }
  async function init(baseUrl) {
    pluginBaseUrl = normalizeBaseUrl(baseUrl);
    J.allowLocalModels = true;
    J.allowRemoteModels = false;
    J.useBrowserCache = false;
    J.useWasmCache = false;
    J.localModelPath = `${pluginBaseUrl}/vendor/models/`;
    const onnxEnv = J.backends?.onnx;
    if (!onnxEnv?.wasm) {
      throw new Error("ONNX wasm backend is not available in this worker bundle.");
    }
    onnxEnv.wasm.proxy = false;
    onnxEnv.wasm.numThreads = 1;
    onnxEnv.wasm.simd = true;
    onnxEnv.wasm.wasmPaths = {
      wasm: getLocalWasmPath()
    };
    if (onnxEnv.webgpu) {
      onnxEnv.webgpu.powerPreference = "high-performance";
    }
    console.log("[Alive BG Worker] Offline mode initialized. WASM path:", onnxEnv.wasm.wasmPaths);
  }
  async function getEstimator() {
    if (depthEstimator) return depthEstimator;
    if (depthEstimatorError) throw depthEstimatorError;
    const modelPath = getModelPath();
    const start = performance.now();
    const deviceAttempts = [];
    if (typeof navigator !== "undefined" && "gpu" in navigator) {
      deviceAttempts.push("webgpu");
    }
    deviceAttempts.push("wasm");
    for (const device of deviceAttempts) {
      try {
        console.log(`[Alive BG Worker] Loading model from: ${modelPath} (device=${device})`);
        depthEstimator = await HY("depth-estimation", modelPath, {
          device,
          local_files_only: true,
          model_file_name: "model",
          dtype: "q8"
        });
        const elapsed = ((performance.now() - start) / 1e3).toFixed(2);
        console.log(`[Alive BG Worker] Model loaded successfully in ${elapsed}s using ${device}`);
        return depthEstimator;
      } catch (e) {
        console.warn(`[Alive BG Worker] Failed to load model with ${device}:`, e);
        depthEstimatorError = e;
      }
    }
    throw depthEstimatorError || new Error("No supported inference device is available.");
  }
  async function loadImageBitmapFromUrl(imageUrl) {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch background image: ${response.status} ${response.statusText}`);
    }
    const blob = await response.blob();
    return createImageBitmap(blob);
  }
  function clamp01(value) {
    return Math.max(0, Math.min(1, value));
  }
  function depthImageToBitmap(depthImage) {
    const { width, height, data } = depthImage;
    const pixelCount = width * height;
    const rgba = new Uint8ClampedArray(pixelCount * 4);
    if (data.length === pixelCount * 4) {
      rgba.set(data);
    } else if (data.length === pixelCount * 3) {
      for (let i = 0; i < pixelCount; i++) {
        const src = i * 3;
        const dst = i * 4;
        rgba[dst] = data[src];
        rgba[dst + 1] = data[src + 1];
        rgba[dst + 2] = data[src + 2];
        rgba[dst + 3] = 255;
      }
    } else if (data.length === pixelCount) {
      for (let i = 0; i < pixelCount; i++) {
        const value = data[i];
        const dst = i * 4;
        rgba[dst] = value;
        rgba[dst + 1] = value;
        rgba[dst + 2] = value;
        rgba[dst + 3] = 255;
      }
    } else {
      throw new Error(`Unexpected depth image buffer length: ${data.length}`);
    }
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d");
    ctx.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas.transferToImageBitmap();
  }
  async function generateHeuristicDepthBitmap(imageUrl) {
    console.warn("[Alive BG Worker] Falling back to heuristic depth generation.");
    const bitmap = await loadImageBitmapFromUrl(imageUrl);
    const width = bitmap.width;
    const height = bitmap.height;
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const source = ctx.getImageData(0, 0, width, height);
    const luma = new Float32Array(width * height);
    for (let i = 0; i < width * height; i++) {
      const offset = i * 4;
      const r = source.data[offset] / 255;
      const g = source.data[offset + 1] / 255;
      const b = source.data[offset + 2] / 255;
      luma[i] = r * 0.299 + g * 0.587 + b * 0.114;
    }
    const sampleLuma = (x, y) => {
      const clampedX = Math.max(0, Math.min(width - 1, x));
      const clampedY = Math.max(0, Math.min(height - 1, y));
      return luma[clampedY * width + clampedX];
    };
    const depthPixels = new Uint8ClampedArray(width * height * 4);
    const widthMax = Math.max(1, width - 1);
    const heightMax = Math.max(1, height - 1);
    for (let y = 0; y < height; y++) {
      const perspective = y / heightMax;
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        const lum = luma[idx];
        const edge = (Math.abs(lum - sampleLuma(x - 1, y)) + Math.abs(lum - sampleLuma(x + 1, y)) + Math.abs(lum - sampleLuma(x, y - 1)) + Math.abs(lum - sampleLuma(x, y + 1))) * 0.25;
        const centerBias = 1 - Math.min(1, Math.abs(x / widthMax - 0.5) * 2);
        const depth = clamp01(perspective * 0.7 + (1 - lum) * 0.1 + edge * (0.15 + centerBias * 0.2));
        const value = Math.round(depth * 255);
        const offset = idx * 4;
        depthPixels[offset] = value;
        depthPixels[offset + 1] = value;
        depthPixels[offset + 2] = value;
        depthPixels[offset + 3] = 255;
      }
    }
    ctx.putImageData(new ImageData(depthPixels, width, height), 0, 0);
    return canvas.transferToImageBitmap();
  }
  async function renderDepthBitmap(imageUrl) {
    try {
      const estimator = await getEstimator();
      console.log("[Alive BG Worker] Starting inference...");
      const start = performance.now();
      const result = await estimator(imageUrl);
      const elapsed = ((performance.now() - start) / 1e3).toFixed(2);
      console.log(`[Alive BG Worker] Inference complete in ${elapsed}s`);
      return depthImageToBitmap(result.depth);
    } catch (error) {
      console.warn("[Alive BG Worker] ML depth generation failed, using heuristic fallback:", error);
      return generateHeuristicDepthBitmap(imageUrl);
    }
  }
  self.onmessage = async (e) => {
    const { type, id: id2, imageUrl, pluginUrl } = e.data;
    if (type === "init") {
      try {
        await init(pluginUrl);
        self.postMessage({ type: "ready" });
      } catch (error) {
        self.postMessage({ type: "error", id: "init", error: "Failed to initialize offline worker: " + error.message });
      }
      return;
    }
    if (type === "process") {
      try {
        console.log("[Alive BG Worker] Received process request for:", imageUrl);
        const bitmap = await renderDepthBitmap(imageUrl);
        self.postMessage({ type: "result", id: id2, bitmap }, [bitmap]);
      } catch (error) {
        console.error("[Alive BG Worker] Process error:", error);
        self.postMessage({ type: "error", id: id2, error: error.message });
      }
    }
  };
})();
