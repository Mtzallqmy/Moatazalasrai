import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "../scripts/sql-utils.mjs";

describe("splitSqlStatements", () => {
  it("keeps semicolons inside strings and dollar-quoted blocks", () => {
    const sql = `
      CREATE TABLE example (value text DEFAULT ';');
      DO $$ BEGIN
        PERFORM 1;
        PERFORM 2;
      END $$;
      INSERT INTO example (value) VALUES ('a; b');
    `;

    const statements = splitSqlStatements(sql);

    expect(statements).toHaveLength(3);
    expect(statements[1]).toContain("PERFORM 1;");
    expect(statements[2]).toContain("'a; b'");
  });

  it("supports comments and rejects unterminated SQL", () => {
    const statements = splitSqlStatements(`
      -- first statement
      SELECT 1;
      /* nested /* comment */ still comment */
      SELECT 2;
    `);

    expect(statements).toHaveLength(2);
    expect(() => splitSqlStatements("SELECT 'unterminated")).toThrow(/unterminated/i);
  });
});
