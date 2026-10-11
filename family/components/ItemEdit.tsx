"use client";
import { useRouter } from "next/navigation";
import type { ShoppingItem, Store } from "@/lib/types";
import { ItemForm } from "./ItemForm";
import { Photo } from "./Photo";

export function ItemEdit({ item, stores, members }: { item: ShoppingItem; stores: Store[]; members: { id: string; name: string }[] }) {
  const router = useRouter();
  return (
    <>
      {item.photo_path && <Photo path={item.photo_path} alt={item.name} className="h-48 w-full" />}
      {item.product_url && (
        <a href={item.product_url} target="_blank" rel="noreferrer" className="btn">
          Open the product page ↗
        </a>
      )}
      <ItemForm item={item} stores={stores} members={members} onClose={() => router.push("/shopping")} />
    </>
  );
}
