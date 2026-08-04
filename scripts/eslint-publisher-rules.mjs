/**
 * Local ESLint rules that reproduce the checks the Obsidian community-plugin review bot
 * runs on top of the `obsidianmd` rule set.
 *
 * The bot rejects a submission for suppressing an `obsidianmd` rule, however well the
 * suppression is argued in a comment, and separately for any disable directive that
 * carries no `-- reason` description. Neither check exists in the plugin, so before 0.5.1
 * a suppression looked clean locally and failed only after submission. These two rules
 * move that failure back to `npm run lint`.
 *
 * One hole is inherent to the mechanism: a blanket disable on the first line of a file
 * switches off every rule from that line on, including these two. It is caught anywhere
 * below the first line, which is where a targeted suppression sits.
 */

/**
 * Matches a disable directive and splits off its rule list and `--` description. The
 * alternation is longest-first: `eslint-disable` would otherwise match the prefix of
 * `eslint-disable-next-line` and leave `-next-line` at the head of the rule list.
 */
const DIRECTIVE = /^\s*(eslint-disable-next-line|eslint-disable-line|eslint-disable)(\s[^]*|$)/;

function parseDirective(comment) {
  const match = DIRECTIVE.exec(comment.value);
  if (!match) return null;
  const [, kind, remainder] = match;
  const separator = remainder.indexOf("--");
  const ruleList = (separator === -1 ? remainder : remainder.slice(0, separator)).trim();
  const description = separator === -1 ? "" : remainder.slice(separator + 2).trim();
  return {
    kind,
    description,
    // An empty rule list is a blanket disable, which switches off every rule there is.
    rules: ruleList === "" ? [] : ruleList.split(",").map((name) => name.trim()),
  };
}

const noObsidianRuleSuppression = {
  meta: {
    type: "problem",
    docs: {
      description: "Disallow suppressing obsidianmd rules, which the community-plugin review rejects.",
    },
    schema: [],
    messages: {
      suppressed: "Disabling '{{rule}}' is not allowed — the community-plugin review rejects it. Fix the code instead.",
      blanket: "A blanket '{{kind}}' also disables the obsidianmd rules, which the community-plugin review rejects.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive = parseDirective(comment);
          if (!directive) continue;
          if (directive.rules.length === 0) {
            context.report({ node: comment, messageId: "blanket", data: { kind: directive.kind } });
            continue;
          }
          for (const rule of directive.rules) {
            if (rule.startsWith("obsidianmd/")) {
              context.report({ node: comment, messageId: "suppressed", data: { rule } });
            }
          }
        }
      },
    };
  },
};

const requireDirectiveDescription = {
  meta: {
    type: "suggestion",
    docs: {
      description: "Require a `-- reason` description on every ESLint disable directive.",
    },
    schema: [],
    messages: {
      undescribed:
        "Unexpected undescribed directive comment. Include a description to explain why the comment is necessary: '{{kind}} <rule> -- <reason>'.",
    },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          const directive = parseDirective(comment);
          if (!directive || directive.description !== "") continue;
          context.report({ node: comment, messageId: "undescribed", data: { kind: directive.kind } });
        }
      },
    };
  },
};

export default {
  meta: { name: "eslint-plugin-publisher" },
  rules: {
    "no-obsidian-rule-suppression": noObsidianRuleSuppression,
    "require-directive-description": requireDirectiveDescription,
  },
};
