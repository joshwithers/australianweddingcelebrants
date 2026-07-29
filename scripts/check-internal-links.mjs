import fs from "node:fs";
import path from "node:path";

const outputDirectory = path.resolve("dist");
const htmlFiles = [];

const collectHtmlFiles = (directory) => {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filePath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      collectHtmlFiles(filePath);
    } else if (filePath.endsWith(".html")) {
      htmlFiles.push(filePath);
    }
  }
};

collectHtmlFiles(outputDirectory);

const missingReferences = new Set();

for (const htmlFile of htmlFiles) {
  const html = fs.readFileSync(htmlFile, "utf8");

  for (const match of html.matchAll(/\b(?:href|src)=["']([^"']+)["']/g)) {
    const rawReference = match[1];
    if (!rawReference.startsWith("/") || rawReference.startsWith("//"))
      continue;

    const pathname = decodeURI(rawReference.split(/[?#]/, 1)[0]);
    if (!pathname) continue;

    const relativePath = pathname.replace(/^\//, "");
    const candidates = pathname.endsWith("/")
      ? [path.join(outputDirectory, relativePath, "index.html")]
      : [
          path.join(outputDirectory, relativePath),
          path.join(outputDirectory, `${relativePath}.html`),
          path.join(outputDirectory, relativePath, "index.html"),
        ];

    if (!candidates.some((candidate) => fs.existsSync(candidate))) {
      missingReferences.add(
        `${path.relative(outputDirectory, htmlFile)} -> ${pathname}`,
      );
    }
  }
}

if (missingReferences.size > 0) {
  console.error(
    `Broken internal references:\n${[...missingReferences].join("\n")}`,
  );
  process.exitCode = 1;
} else {
  console.log(
    `Validated internal links and assets across ${htmlFiles.length} HTML pages.`,
  );
}
