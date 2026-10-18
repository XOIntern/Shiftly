import { describe, expect, test } from "bun:test";
import { getTableName } from "drizzle-orm";
import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import { department, workArea } from "../drizzle/schema";
import { site, siteLocation } from "../drizzle/schema";

// Task 1 of the departments & work areas epic (GitHub #57/#58): the
// `department` and `work_area` tables exist with the soft-delete column
// set, both partial unique indexes, and the composite FKs that pin a
// work_area's department and site_location onto the same site.
describe("department + work_area schema (issue #58 task 1)", () => {
  const config = (table: PgTable) => getTableConfig(table);
  const columnNames = (table: PgTable) =>
    config(table).columns.map((column) => column.name);

  test("department columns follow the soft-delete pattern", () => {
    expect(config(department).name).toBe("department");
    const names = columnNames(department);
    for (const name of [
      "id",
      "site_id",
      "name",
      "is_active",
      "created_at",
      "updated_at",
      "deleted_at",
    ]) {
      expect(names).toContain(name);
    }
    // is_active defaults to true...
    expect(config(department).columns.find((c) => c.name === "is_active")?.hasDefault).toBe(true);
    // ...and deleted_at is nullable (soft delete), unlike site_id/name.
    expect(
      config(department).columns.find((c) => c.name === "deleted_at")?.notNull,
    ).toBe(false);
    expect(
      config(department).columns.find((c) => c.name === "site_id")?.notNull,
    ).toBe(true);
  });

  test("work_area columns: department_id + site_location_id + site_id, all not null", () => {
    expect(config(workArea).name).toBe("work_area");
    const names = columnNames(workArea);
    for (const name of [
      "id",
      "department_id",
      "site_location_id",
      "site_id",
      "name",
      "is_active",
      "created_at",
      "updated_at",
      "deleted_at",
    ]) {
      expect(names).toContain(name);
    }
    for (const name of ["department_id", "site_location_id", "site_id"]) {
      expect(
        config(workArea).columns.find((c) => c.name === name)?.notNull,
      ).toBe(true);
    }
  });

  test("department partial unique index on (site_id, name)", () => {
    const indexes = config(department).indexes;
    const unique = indexes.find(
      (index) => index.config.name === "department_site_id_name_unique",
    );
    expect(unique).toBeTruthy();
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.where).toBeTruthy();
    expect(
      unique?.config.columns.map((c) => (c as { name: string }).name),
    ).toEqual(["site_id", "name"]);
  });

  test("work_area partial unique index on (site_location_id, name)", () => {
    const indexes = config(workArea).indexes;
    const unique = indexes.find(
      (index) => index.config.name === "work_area_site_location_id_name_unique",
    );
    expect(unique).toBeTruthy();
    expect(unique?.config.unique).toBe(true);
    expect(unique?.config.where).toBeTruthy();
  });

  test("composite FKs: work_area(department_id, site_id) and work_area(site_location_id, site_id)", () => {
    const fks = config(workArea).foreignKeys;
    const names = fks.map((fk) => fk.reference().name);
    const deptFk = fks.find((fk) =>
      fk.reference().name?.startsWith("work_area_department"),
    );
    const locFk = fks.find((fk) =>
      fk.reference().name?.startsWith("work_area_site_location"),
    );
    expect(deptFk).toBeTruthy();
    expect(locFk).toBeTruthy();
    expect(names).toContain("work_area_department_site_fk");
    expect(names).toContain("work_area_site_location_site_fk");

    const deptRef = deptFk?.reference();
    expect(deptRef?.columns.map((c) => c.name)).toEqual(["department_id", "site_id"]);
    expect(deptRef?.foreignColumns.map((c) => c.name)).toEqual(["id", "site_id"]);
    expect(deptRef && getTableName(deptRef.foreignTable)).toBe("department");

    const locRef = locFk?.reference();
    expect(locRef?.columns.map((c) => c.name)).toEqual(["site_location_id", "site_id"]);
    expect(locRef?.foreignColumns.map((c) => c.name)).toEqual(["id", "site_id"]);
    expect(locRef && getTableName(locRef.foreignTable)).toBe("site_location");
  });

  test("plain unique CONSTRAINTS on parent pairs department(id, site_id) and site_location(id, site_id)", () => {
    // Constraints, not indexes: drizzle-kit emits ALTER-FK statements before
    // CREATE-INDEX, and Postgres requires the referenced unique key to exist
    // at FK-creation time. Inline constraints are inside CREATE TABLE.
    const deptNames = config(department).uniqueConstraints.map(
      (constraint) => constraint.name,
    );
    expect(deptNames).toContain("department_id_site_id_unique");

    const deptPair = config(department).uniqueConstraints.find(
      (constraint) => constraint.name === "department_id_site_id_unique",
    );
    expect(
      deptPair?.columns.map((c) => (c as { name: string }).name),
    ).toEqual(["id", "site_id"]);

    const locPair = config(siteLocation).uniqueConstraints.find(
      (constraint) => constraint.name === "site_location_id_site_id_unique",
    );
    expect(locPair).toBeTruthy();
    expect(
      locPair?.columns.map((c) => (c as { name: string }).name),
    ).toEqual(["id", "site_id"]);
  });

  test("department FK references site with restrict delete", () => {
    const fks = config(department).foreignKeys;
    const siteFk = fks.find(
      (fk) => getTableName(fk.reference().foreignTable) === "site",
    );
    expect(siteFk).toBeTruthy();
    expect(siteFk?.reference().columns.map((c) => c.name)).toEqual(["site_id"]);
    expect(siteFk?.onDelete).toBe("restrict");
  });

  test("relations: department ↔ site/workAreas; work_area ↔ department/siteLocation/site; site/siteLocation extended", async () => {
    const mod = await import("../drizzle/schema");
    for (const name of [
      "departmentRelations",
      "workAreaRelations",
      "siteRelations",
      "siteLocationRelations",
    ]) {
      expect((mod as Record<string, unknown>)[name]).toBeTruthy();
    }
  });
});
