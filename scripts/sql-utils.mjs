export function splitSqlStatements(source) {
  const statements = [];
  let current = "";
  let index = 0;
  let singleQuoted = false;
  let doubleQuoted = false;
  let lineComment = false;
  let blockCommentDepth = 0;
  let dollarTag = null;

  while (index < source.length) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      index += 1;
      continue;
    }

    if (blockCommentDepth > 0) {
      current += char;
      if (char === "/" && next === "*") {
        current += next;
        blockCommentDepth += 1;
        index += 2;
        continue;
      }
      if (char === "*" && next === "/") {
        current += next;
        blockCommentDepth -= 1;
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (dollarTag) {
      if (source.startsWith(dollarTag, index)) {
        current += dollarTag;
        index += dollarTag.length;
        dollarTag = null;
      } else {
        current += char;
        index += 1;
      }
      continue;
    }

    if (singleQuoted) {
      current += char;
      if (char === "'" && next === "'") {
        current += next;
        index += 2;
        continue;
      }
      if (char === "'") singleQuoted = false;
      index += 1;
      continue;
    }

    if (doubleQuoted) {
      current += char;
      if (char === '"' && next === '"') {
        current += next;
        index += 2;
        continue;
      }
      if (char === '"') doubleQuoted = false;
      index += 1;
      continue;
    }

    if (char === "-" && next === "-") {
      current += char + next;
      lineComment = true;
      index += 2;
      continue;
    }

    if (char === "/" && next === "*") {
      current += char + next;
      blockCommentDepth = 1;
      index += 2;
      continue;
    }

    if (char === "'") {
      current += char;
      singleQuoted = true;
      index += 1;
      continue;
    }

    if (char === '"') {
      current += char;
      doubleQuoted = true;
      index += 1;
      continue;
    }

    if (char === "$") {
      const match = source.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) {
        dollarTag = match[0];
        current += dollarTag;
        index += dollarTag.length;
        continue;
      }
    }

    if (char === ";") {
      const statement = current.trim();
      if (statement) statements.push(statement);
      current = "";
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);

  if (singleQuoted || doubleQuoted || dollarTag || blockCommentDepth > 0) {
    throw new Error("Migration SQL contains an unterminated quoted string or comment.");
  }

  return statements;
}
