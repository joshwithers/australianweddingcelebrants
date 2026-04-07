import { slugify } from "./textConverter";

/**
 * Filter items by taxonomy
 * @param {Array} items - Array of items to filter
 * @param {String} taxonomy - Taxonomy to filter by
 * @param {String} term - Term to filter by
 * @returns {Array} - Filtered items
 */
const taxonomyFilter = (items: any[], taxonomy: string, term: string) => {
  return items.filter((item) =>
    item.data[taxonomy]?.map((t: string) => slugify(t)).includes(slugify(term))
  );
};

export default taxonomyFilter;
