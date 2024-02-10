const prettier = require("prettier");
const path = require("path");
const fs = require("fs");

fs.writeFileSync(
  "./tsPlugin.log",
  `${"-".repeat(
    100
  )}\ntsPlugin.js logs (${new Date().toLocaleString()})\n${"-".repeat(100)}`
);

const processLogFile = (message, silent) => {
  const log = message
    .map((value) => {
      if (typeof value === "string") {
        return value;
      } else {
        try {
          return JSON.stringify(value, null, 2);
        } catch {
          try {
            return value.toString();
          } catch {
            return `${value}`;
          }
        }
      }
    }, [])
    .join(" ");
  silent || console.log(...message);
  fs.appendFileSync("./tsPlugin.log", `\n${log}`);
};

const print = (...message) => processLogFile(message, false);
print.silent = (...message) => processLogFile(message, true);

const getCodeViewer = (script, targetLine = 0, scale = 0, offset = 1) => {
  const full = script
    .split("\n")
    .map((x, i) => `${`${i + offset}`.padStart(5)} | ${x}`);
  return (
    scale === 0 ? full : full.slice(targetLine - scale || 0, targetLine + scale)
  ).join("\n");
};

const escapeRegex = (x) => x.replace(/[/\-\\^$*+?.()|[\]{}]/g, "\\$&");

const inject = (text, regex, statement) => {
  const searchIndex = text.search(regex);
  if (searchIndex > -1) {
    const newText =
      text.substring(0, searchIndex) + statement + text.substr(searchIndex);
    return newText;
  }
  return text;
};

const getArgTypes = (text) => {
  const regex = /@param \{(.+)\} (\[?)([a-zA-Z0-9_\$]+)\]? -/;
  const metaList = text.match(new RegExp(regex, "g")) ?? [];
  return Object.entries(
    metaList.reduce((p, c) => {
      const [, type, nullable, val] = c.match(regex);
      const dec = `${
        type
          .replace("function", "(...args: any) => any")
          .replace("array", "any[]")
          .replace("Stage", "typeof Stage")
          .replace("Bitmap", "typeof Bitmap")
        //
      }${nullable ? " | undefined" : ""}`;
      let set = p[val];
      if (set) {
        set.add(dec);
      } else {
        set = new Set([dec]);
      }
      return { ...p, [val]: set };
    }, {})
  ).reduce((p, [val, types]) => ({ ...p, [val]: [...types].join(" | ") }), {});
};

const getFunctions = (text) => {
  const regex =
    /^\s+([a-zA-Z\$_][a-zA-Z\$_0-9\.]+)?\s+([a-zA-Z\$_]+[a-zA-Z\$_0-9]+)\s*\(([a-zA-Z\$_][a-zA-Z0-9\$_,\s\n=]+)\)\s*\{/;
  return (text.match(new RegExp(regex, "gm")) ?? []).reduce((p, c) => {
    const [matches, head, method, argText] =
      c.match(new RegExp(regex, "ms")) ?? [];
    if (!argText || ["if", "for", "while", "switch", "catch"].includes(method))
      return p;
    return [
      ...p,
      {
        method,
        args: argText.split(",").map((x) => {
          const text = x.trim();
          const [, name, _, to] = text.match(/(\S+)(\s=\s(\S+))/) ?? [, text];
          return { name, to };
        }),
        origin: matches.trim(),
        head: head ?? "",
      },
    ];
  }, []);
};

const getPrototypeInterfaces = (text) => {
  const regex =
    /^([A-Za-z\$_][A-Za-z\$_0-9]+)\.prototype\.([A-Za-z\$_][A-Za-z\$_0-9]+)\s*=\s*function\s*\((.*?)\)/;
  return Object.entries(
    [...(text.match(new RegExp(regex, "gm")) ?? [])].reduce((p, line) => {
      const [, type, method, args] = line.match(regex) ?? [];
      const result = {
        method,
        args: args === "" ? [] : args.split(",").map((x) => x.trim()),
      };
      let set = p[type];
      if (set) {
        set.add(result);
      } else {
        set = new Set([result]);
      }
      return {
        ...p,
        [type]: set,
      };
    }, {})
  )
    .map(
      ([type, values]) =>
        `interface ${{ Array: "Array<T>" }[type] ?? type} {\n${[...values]
          .map(
            ({ method, args }) =>
              `  ${method}: (${args
                .map((arg) => `${arg}: any`)
                .join(", ")}) => any;`
          )
          .join("\n")}\n}`
    )
    .join("\n");
};

const getMemberVariableTypeData = (value, member = null) => {
  let name = "";
  let type = "";
  switch (true) {
    case [
      /^"[^"]*"$/,
      /^.+[\|&\?]{2}\s*"[^"]*"$/,
      /^'[^']*'$/,
      /^.+[\|&\?]{2}\s*'[^']*'$/,
      /^`[^`]*`$/,
      /^.+[\|&\?]{2}\s*`[^`]*`$/,
    ].some((x) => x.test(value)):
      [name, type] = ["STRING", "string"];
      return { name, type };
    case [
      /^[\-\+]*([\d\.]+|NaN|Infinity)$/,
      /^.+[\|&\?]{2}\s*[\-\+]*([\d\.]+|NaN|Infinity)$/,
      /^[^\(\?"'`]+[\-\*\/%].+$/,
      /^.+[\|&\?]{2}\s*[^\(\?]+[\-\+\*\/%].+$/,
      /^.+[\+\-\*\/%]\s*[\-\+]*([\d\.]+|NaN|Infinity)$/,
      /^.+[\+\-\*\/%]\s*[\-\+]*[a-zA-Z0-9\$_\.]+$/,
      /^.+[\+\-\*\/%]\s*[\-\+]*[a-zA-Z0-9\$_\.]+\(\)$/,
      /^.+[\+\-\*\/%]\s*[\-\+]*[a-zA-Z0-9\$_\.]+\(\)\.[a-zA-Z0-9\$_\.]+$/,
      /^.+[\+\-\*\/%]\s*\([^\(\)]+\)$/,
      /^[a-zA-Z0-9\$_\.]+[\+\-]{2}$/,
    ].some((x) => x.test(value)):
      [name, type] = ["NUMBER", "number"];
      return { name, type };
    case [
      /^(false|true)$/,
      /^.+[\|&\?]{2}\s*(false|true)$/,
      /^![a-zA-Z0-9\$_\.]+$/,
      /^[^\?]+(===|==|<=|<|>=|[^=]>|!==|!=)[^\?]+$/,
      /^.+[\|&\?]{2}\s*![a-zA-Z0-9\$_\.]+$/,
    ].some((x) => x.test(value)):
      [name, type] = ["BOOLEAN", "boolean"];
      return { name, type };
    case [/^null$/, /^.+[\|&\?]{2}\s*null$/].some((x) => x.test(value)):
      [name, type] = ["NULL", "null"];
      return { name, type };
    case [
      /^(undefined|void\s*0)$/,
      /^.+[\|&\?]{2}\s*(undefined|void\s*0)$/,
    ].some((x) => x.test(value)):
      [name, type] = ["UNDEFINED", "undefined"];
      return { name, type };
    case /^\{.*\}$/.test(value):
      [name, type] = ["OBJECT", "{}"];
      return { name, type };
    case /^\[(.*)\]$/.test(value):
      const arrayArgText = value.match(/^\[(.*)\]$/)?.at(1) ?? "";
      const arrayChildTypes = [
        ...new Set(
          arrayArgText
            .split(",")
            .map((x) => getMemberVariableTypeData(x.trim()))
            .map((x) =>
              ![
                "NUMBER",
                "STRING",
                "BOOLEAN",
                "NULL",
                "UNDEFINED",
                "INSTANCE",
                "UNKNOWN",
              ].includes(x.name)
                ? "unknown"
                : x.type
            )
        ),
      ];
      const arrayTuple = arrayChildTypes.join(" | ");
      [name, type] = [
        "ARRAY",
        `${
          arrayChildTypes.length === 1
            ? arrayTuple === "unknown"
              ? ""
              : arrayTuple
            : `(${arrayTuple})`
        }[]`,
      ];
      return { name, type };
    case /^new\s+([a-zA-Z0-9\$_\.]+)\(.+$/.test(value):
      const className =
        value.match(/^new\s+([a-zA-Z0-9\$_\.]+)\(.+$/)?.at(1) ?? "";
      [name, type] = [
        "INSTANCE",
        /^[A-Z]/.test(className) ? `typeof ${className}` : "{}",
      ];
      return { name, type };
    case /^([a-zA-Z\$_\.]+)$/.test(value):
      [name, type] = ["DICT_VAR", "unknown"];
      return { name, type };
    case /^([a-zA-Z\$_\.]+)\(.+$/.test(value):
      [name, type] = ["DICT_RET", "unknown"];
      return { name, type };
    case /^[^\?]+\?\s*(.+)\s*:\s*(.+)$/.test(value):
      const [, a, b] = value.match(/^[^\?]+\?\s*(.+)\s*:\s*(.+)$/);
      const condTypes = [
        ...new Set(
          [a, b]
            .map((x) => getMemberVariableTypeData(x))
            .map((x) =>
              ![
                "NUMBER",
                "STRING",
                "BOOLEAN",
                "NULL",
                "UNDEFINED",
                "INSTANCE",
                "UNKNOWN",
              ].includes(x.name)
                ? "unknown"
                : x.type
            )
        ),
      ];
      const condTuple = condTypes.join(" | ");
      [name, type] = [
        "CONDITION",
        condTypes.length === 1 ? condTuple : `(${condTuple})`,
      ];
      return { name, type };
    default:
      [name, type] = ["UNKNOWN", "unknown"];
      return { name, type };
  }
};

/** @type {import("ts-migrate-server").Plugin<{}>} */
const plugin = {
  name: "custom",
  async run({ text, fileName, sourceFile, options: { stopper } }) {
    const className = path.parse(fileName).name;
    print("\n___", className, "_".repeat(50), `\n-> ${fileName}\n`);

    let newText = text;

    try {
      // "prettier-ignore" を消す
      newText = newText.replaceAll("// prettier-ignore", "");

      // prototype 拡張を集計して interface 化する
      newText = `${getPrototypeInterfaces(text)}\n${newText}`;

      // グローバル型を定義する
      newText = `/// <reference path="../../global.d.ts" />\n${newText}`;

      // static class function を class にする
      newText = newText.replace(
        /^function ([A-Z][a-zA-Z]+)\((.*?)\).+\n(.+?throw.+?static class.+?)\n\}/ms,
        "class $1 {\n  constructor($2) {\n  $3\n  }\n}"
      );

      // class をエクスポートする
      newText = inject(
        newText,
        /^class [A-Z][a-zA-Z0-9_\$]+/ms,
        "export default "
      );

      // @params を取得して型アサーションを追加
      const [argTypes, functions] = [getArgTypes(text), getFunctions(text)];
      if (Object.keys(argTypes).length) {
        functions.forEach(({ method, args, origin, head }) => {
          const argNames = args.map((x) => x.name);
          const after = `${head} ${method}(${args
            .map(
              ({ name, to }) =>
                `${name}${
                  to && argNames.includes(to)
                    ? ` = ${to}`
                    : `: ${argTypes[name] ?? "any"}`
                }`
            )
            .join(", ")}) {`;
          newText = newText.replace(origin, after);
        });
      }

      // メンバ変数の宣言を追加する
      const constructorRegex = /^\s+constructor\s*\(/ms;
      if (newText.match(constructorRegex)) {
        const regex = /(this\.[a-zA-Z\$_]+)\s*=[^=]\s*(.+)\s*;/;
        const matches = [...new Set(text.match(new RegExp(regex, "gm")) ?? [])];
        const declareMembers = Object.entries(
          matches.reduce((p, c) => {
            const [, member, value] = c.match(regex);
            if (!/^this\._/.test(member)) return p;
            const { type } = getMemberVariableTypeData(value, member);
            let set = p[member];
            if (set) {
              set.add(type);
            } else {
              set = new Set([type]);
            }
            return { ...p, [member.replace(/^this\./, "")]: set };
          }, {})
        ).map(([member, set]) => `declare ${member}: ${[...set].join(" | ")};`);
        newText = inject(newText, constructorRegex, declareMembers.join("\n"));
      }

      // hoistClassStaticsPlugin の抜け漏れを対処するため、
      // 本来 static になっていなければならない変数や関数を
      // JSDoc と一緒に static 化する

      // まずJSDocを取得する
      const staticJsdocRegex =
        /(\/\*\*\s*\n([^\*]|(\*(?!\/)))*\*\/)\r?\n([A-Z\$_a-z0-9\.]+) =/;
      const jsdocs = (
        text.match(new RegExp(staticJsdocRegex, "gms")) ?? []
      ).map((j) => {
        const [, jsdoc, _, __, target] = j.match(
          new RegExp(staticJsdocRegex, "ms")
        );
        return { jsdoc, target };
      });
      // Bitmap.load のような宣言を取得する
      const staticDefines = sourceFile.statements
        .filter(
          (s) =>
            ![
              /^class/,
              /^Object.define/,
              /This is a static class/,
              /^function/,
            ].some((r) => r.test(s.getText()))
        )
        .reduce((p, c) => {
          const { expression } = c;
          const dist = [
            expression?.left?.getText(),
            expression?.operatorToken?.getText(),
            expression?.right?.getText(),
          ];
          const [left, op, right] = dist;
          const isValid =
            // 式になっていて
            dist.some((x) => !!x) &&
            // 代入式で
            op === "=" &&
            // 左辺に親クラスを指定
            new RegExp(`^${className}\.`).test(left) &&
            // `.` はひとつだけ
            left.match(/\./g)?.length === 1;
          return isValid
            ? [...p, [left.replace(`${className}.`, ""), right]]
            : p;
        }, []);

      // JSDoc と実装を関連付けて置換
      staticDefines.forEach(([left, right]) => {
        const code = `static ${left.replace(
          `${className}.`,
          ""
        )} = ${right};\n`;
        const { jsdoc } =
          jsdocs.find((d) => `${className}.${left}` === d.target) ?? {};
        const script = `${jsdoc ?? ""}\n${code}`;
        newText = newText.replace(
          new RegExp(
            `${className}.${left}\\s*=\\s*${escapeRegex(right)};`,
            "gms"
          ),
          ""
        );
        if (jsdoc) {
          newText = newText.replace(jsdoc, "");
        }
        newText = inject(newText, constructorRegex, script);
      });

      try {
        // prittier を通す
        newText = prettier.format(newText, { parser: "babel" });
      } catch (error) {
        // フォーマットエラー
        const BORDER = "=".repeat(10);
        const targetLine = error.loc.start.line - 2;
        [
          BORDER,
          error.codeFrame.replaceAll("", "").replace(/\[\d+m/g, ""),
          BORDER,
          getCodeViewer(newText, targetLine, 10, 2),
          BORDER,
        ].forEach((x) => print(x));
      }

      // どうにもならなかったピンポイントなエラーを無理やり修正
      if (fileName.match("Window_StatusBase.ts")) {
        newText = newText.replace("sprite.hide();", "(sprite as any).hide();");
      }
    } catch (e) {
      console.error(e);
      print.silent(e.message, e.name, e.stack);
      print.silent("newText =");
      print.silent(getCodeViewer(newText));
      stopper();
    }

    return newText;
  },
};

module.exports = plugin;
