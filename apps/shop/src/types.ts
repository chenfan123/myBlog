export type Category = "All" | "Home" | "Audio" | "Wear" | "Travel";

export type Product = {
  id: number;
  name: string;
  nameZh: string;
  category: Exclude<Category, "All">;
  price: number;
  compareAt?: number;
  rating: number;
  reviews: number;
  image: string;
  alt: string;
  colors: string[];
  badge?: string;
  description: string;
  descriptionZh: string;
  details: string[];
  detailsZh: string[];
};

export type CartLine = {
  productId: number;
  quantity: number;
};
