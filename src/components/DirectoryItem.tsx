import React from 'react';
import { humanize } from "@/lib/utils/textConverter";
import type { ImageMetadata } from 'astro';

export interface DirectoryItemProps {
  item: {
    slug: string;
    data: {
      title: string;
      description?: string;
      image?: string | ImageMetadata;
      logo?: string | ImageMetadata;
      category: string[];
      location: string[];
      featured?: boolean;
      website?: string;
      date?: string;
    };
  };
  isFirst?: boolean;
}

const DirectoryItem: React.FC<DirectoryItemProps> = ({ item, isFirst }) => {
  // Helper function to get image URL from string or ImageMetadata
  const getImageUrl = (image: string | ImageMetadata | undefined): string | undefined => {
    if (!image) return undefined;
    if (typeof image === 'string') return image;
    return image.src; // ImageMetadata has a src property
  };

  const imageUrl = getImageUrl(item.data.image);
  const logoUrl = getImageUrl(item.data.logo);

  return (
    <div className="mb-8 md:col-6 lg:col-4">
      <div className="bg-theme-light rounded p-4 hover:shadow-lg transition duration-300">
        {imageUrl && (
          <a
            href={`/directory/${item.slug}/`}
            className="block mb-4 overflow-hidden rounded aspect-[4/3] relative"
          >
            <img
              src={imageUrl}
              alt={item.data.title}
              width={400}
              height={300}
              loading={isFirst ? "eager" : "lazy"}
              className="w-full h-full absolute top-0 left-0 object-cover object-top hover:scale-105 transition duration-300"
            />
          </a>
        )}
        
        <div className="flex items-center justify-between mb-4 min-h-[64px]">
          {logoUrl ? (
            <div className="h-16 relative">
              <img
                src={logoUrl}
                alt={item.data.title}
                width={180}
                height={64}
                loading={isFirst ? "eager" : "lazy"}
                className="h-full w-auto max-w-[180px] object-contain"
              />
            </div>
          ) : (
            <a href={`/directory/${item.slug}/`}><h2 className="h5">{item.data.title}</h2></a>
          )}
          {item.data.featured && (
            <span className="bg-normal text-normal font-semibold text-xs px-2 py-1 rounded">
              Featured
            </span>
          )}
        </div>
        
        {item.data.description && (
          <p className="text-sm mb-4 line-clamp-3">{item.data.description}</p>
        )}
        
        <div className="flex flex-wrap gap-2 mb-4">
          {item.data.category.map((cat, i) => (
            <span key={i} className="bg-white text-xs px-2 py-1 rounded flex items-start">
              {humanize(cat)}
            </span>
          ))}
        </div>
        
        <div className="mt-auto">
          <a
            href={`/directory/${item.slug}/`}
            className="inline-block text-normal font-semibold hover:underline"
          >
            View Details
          </a>
          {item.data.website && (
            <a
              href={item.data.website}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block ml-4 text-primary hover:underline"
            >
              Visit Website
            </a>
          )}
        </div>
      </div>
    </div>
  );
};

export default DirectoryItem;