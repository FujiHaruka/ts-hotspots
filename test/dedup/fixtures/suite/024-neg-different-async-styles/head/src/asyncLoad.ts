export async function asyncLoad(id: string): Promise<string> {
  return new Promise<string>((resolve) => {
    setTimeout(() => {
      resolve(`data-${id}`);
    }, 10);
  });
}
