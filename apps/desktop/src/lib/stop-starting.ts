// Stop again after startup settles in case cancellation reached the backend first.
export async function stopStarting(cancel: () => Promise<void>, starting?: Promise<void>): Promise<void> {
  await cancel();
  if (starting) {
    await starting.catch(() => {});
    await cancel();
  }
}
