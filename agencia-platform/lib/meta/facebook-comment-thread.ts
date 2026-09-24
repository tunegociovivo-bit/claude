type FacebookComment = {
  id: string;
  parent?: { id: string };
  comments?: { data?: FacebookComment[]; paging?: { next?: string } };
  [key: string]: unknown;
};

/** Read the whole thread before filtering dates, including replies to older parents. */
export async function readFacebookCommentThread(postId: string, readAll: (path: string) => Promise<FacebookComment[]>) {
  const fields = "id,message,from{id,name},created_time,parent{id},comments.limit(100){id,message,from{id,name},created_time,parent{id}}";
  const parents = await readAll(`${postId}/comments?fields=${fields}&limit=100&filter=toplevel`);
  const result = new Map<string, FacebookComment>();
  const visit = async (comment: FacebookComment) => {
    if (result.has(comment.id)) return;
    result.set(comment.id, comment);
    const children = comment.comments?.paging?.next
      ? await readAll(`${comment.id}/comments?fields=${fields}&limit=100&filter=toplevel`)
      : comment.comments?.data ?? [];
    for (const child of children) await visit({ ...child, parent: child.parent ?? { id: comment.id } });
  };
  for (const parent of parents) await visit(parent);
  return [...result.values()];
}
