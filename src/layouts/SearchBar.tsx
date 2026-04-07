import React from "react";
import { humanize } from "@/lib/utils/textConverter";
import Fuse from "fuse.js";
import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

export type SearchItem = {
  slug: string;
  data: any;
  content: any;
  type: "directory";
};

interface Props {
  searchList: SearchItem[];
}

interface SearchResult {
  item: SearchItem;
  refIndex: number;
}

const tierLabels: Record<string, { label: string; color: string }> = {
  luminary: { label: "Luminary", color: "#460479" },
  endorsed: { label: "Endorsed", color: "#92174d" },
  registered: { label: "Registered", color: "#6a6a6a" },
};

export default function SearchBar({ searchList }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(
    null,
  );

  const handleChange = (e: FormEvent<HTMLInputElement>) => {
    setInputVal(e.currentTarget.value);
  };

  const fuse = new Fuse(searchList, {
    keys: [
      { name: "data.title", weight: 2 },
      { name: "data.description", weight: 1.5 },
      { name: "data.location", weight: 1.5 },
      { name: "data.category", weight: 1 },
      { name: "data.categories", weight: 1 },
      { name: "data.tags", weight: 0.5 },
      { name: "content", weight: 0.5 },
    ],
    includeMatches: true,
    minMatchCharLength: 2,
    threshold: 0.4,
  });

  useEffect(() => {
    const searchUrl = new URLSearchParams(window.location.search);
    const searchStr = searchUrl.get("q");
    if (searchStr) setInputVal(searchStr);

    setTimeout(function () {
      inputRef.current!.selectionStart = inputRef.current!.selectionEnd =
        searchStr?.length || 0;
    }, 50);
  }, []);

  useEffect(() => {
    let inputResult = inputVal.length > 1 ? fuse.search(inputVal) : [];
    setSearchResults(inputResult);

    if (inputVal.length > 0) {
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set("q", inputVal);
      const newRelativePathQuery =
        window.location.pathname + "?" + searchParams.toString();
      history.pushState(null, "", newRelativePathQuery);
    } else {
      history.pushState(null, "", window.location.pathname);
    }
  }, [inputVal]);

  return (
    <div className="min-h-[45vh]">
      <input
        className="form-input w-full text-center"
        placeholder="Search celebrants, locations, or categories..."
        type="text"
        name="search"
        value={inputVal}
        onChange={handleChange}
        autoComplete="off"
        autoFocus
        ref={inputRef}
      />

      {inputVal.length > 1 && (
        <div className="my-6 text-center text-sm" style={{ color: "#6a6a6a", fontWeight: 400 }}>
          Found {searchResults?.length}
          {searchResults?.length === 1 ? " result" : " results"}{" "}
          for '{inputVal}'
        </div>
      )}

      <div className="row">
        {searchResults?.map(({ item }) => (
          <DirectoryResult key={item.slug} item={item} />
        ))}
      </div>
    </div>
  );
}

function DirectoryResult({ item }: { item: SearchItem }) {
  const tier = item.data.tier || "registered";
  const tierInfo = tierLabels[tier] || tierLabels.registered;

  return (
    <div className="col-12 sm:col-6 lg:col-4 mb-8">
      <a
        href={`/directory/${item.slug}/`}
        className="block no-underline group"
      >
        <div
          className="rounded-[20px] overflow-hidden bg-white transition-shadow duration-300"
          style={{
            boxShadow:
              "rgba(0,0,0,0.02) 0px 0px 0px 1px, rgba(0,0,0,0.04) 0px 2px 6px, rgba(0,0,0,0.1) 0px 4px 8px",
          }}
        >
          {item.data.image && (
            <div className="relative overflow-hidden">
              <img
                src={item.data.image}
                alt={item.data.title}
                className="w-full h-auto group-hover:scale-[1.03] transition-transform duration-500"
                loading="lazy"
              />
              <span
                className="absolute top-3 left-3 text-xs px-3 py-1 rounded-[14px] flex items-center gap-1.5"
                style={{
                  fontWeight: 600,
                  color: tier === "registered" ? "#6a6a6a" : "#fff",
                  background:
                    tier === "registered"
                      ? "rgba(255,255,255,0.9)"
                      : tierInfo.color,
                  backdropFilter: "blur(4px)",
                }}
              >
                {tierInfo.label}
              </span>
            </div>
          )}
          <div className="p-4">
            <h3
              className="text-base m-0"
              style={{
                fontWeight: 600,
                letterSpacing: "-0.18px",
                lineHeight: "1.25",
                color: "#222",
              }}
            >
              {item.data.title}
            </h3>
            {item.data.location && item.data.location.length > 0 && (
              <p
                className="text-sm mt-1 mb-2"
                style={{ color: "#6a6a6a", fontWeight: 400 }}
              >
                {item.data.location.map(humanize).join(" · ")}
              </p>
            )}
            {item.data.description && (
              <p
                className="text-sm mb-0"
                style={{
                  color: "#6a6a6a",
                  fontWeight: 400,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {item.data.description}
              </p>
            )}
          </div>
        </div>
      </a>
    </div>
  );
}
