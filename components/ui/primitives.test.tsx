import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { Button } from "./button";
import { Card, CardFooter } from "./card";
import { Input } from "./input";
import { InputGroup } from "./input-group";
import { Textarea } from "./textarea";
import { Table, TableBody, TableHead, TableHeader, TableRow } from "./table";

// Design system v3.0.0 shapes: flat hairline cards at the 8px step, quiet
// table hover wash, 6px buttons. Pinned on class names because the tokens
// behind them are pinned in app/globals.test.ts.
describe("primitives follow the v3 shape language", () => {
  test("Card is an 8px hairline surface, not a 16px ring-tinted one", () => {
    const html = renderToStaticMarkup(<Card>x</Card>);
    expect(html).toContain("rounded-lg");
    expect(html).toContain("ring-border");
    expect(html).not.toContain("rounded-xl");
    expect(html).not.toContain("ring-foreground/10");
  });

  test("CardFooter has no tinted background", () => {
    const html = renderToStaticMarkup(<CardFooter>x</CardFooter>);
    expect(html).not.toContain("bg-muted/50");
  });

  test("TableRow hovers with the grey wash", () => {
    const html = renderToStaticMarkup(
      <Table>
        <TableBody>
          <TableRow>
            <td>x</td>
          </TableRow>
        </TableBody>
      </Table>,
    );
    expect(html).toContain("hover:bg-hover");
    expect(html).not.toContain("hover:bg-muted/50");
  });

  test("TableHead text is the secondary ink", () => {
    const html = renderToStaticMarkup(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
          </TableRow>
        </TableHeader>
      </Table>,
    );
    expect(html).toContain("text-foreground-secondary");
  });

  test("Button corners are 6px", () => {
    const html = renderToStaticMarkup(<Button>Go</Button>);
    expect(html).toContain("rounded-md");
    expect(html).not.toContain("rounded-lg");
  });

  test("Input disables to the muted fill and keeps 6px corners", () => {
    const html = renderToStaticMarkup(<Input disabled />);
    expect(html).toContain("disabled:bg-muted");
    expect(html).not.toContain("disabled:bg-input/50");
    expect(html).toContain("rounded-md");
    expect(html).not.toContain("rounded-lg");
  });

  test("Textarea disables to the muted fill and keeps 6px corners", () => {
    const html = renderToStaticMarkup(<Textarea disabled />);
    expect(html).toContain("disabled:bg-muted");
    expect(html).not.toContain("disabled:bg-input/50");
    expect(html).toContain("rounded-md");
    expect(html).not.toContain("rounded-lg");
  });

  test("InputGroup disables to the muted fill and keeps 6px corners", () => {
    const html = renderToStaticMarkup(<InputGroup>x</InputGroup>);
    expect(html).toContain("has-disabled:bg-muted");
    expect(html).not.toContain("has-disabled:bg-input/50");
    expect(html).toContain("rounded-md");
    expect(html).not.toContain("rounded-lg");
  });
});
