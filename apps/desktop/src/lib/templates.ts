import type { LLObject } from "./objects";
import { objects } from "./objects";
import { createPage, space, typeOf } from "./space";

// A template is a page whose "templateOf" names its type. It is hidden from lists, links and
// the sidebar, and edited like any page.
export const templatesOf = (typeId: string) => space.get().pages.filter((p) => p.properties.templateOf === typeId);

const day = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const fill = (title: string) => title.replaceAll("{date}", day.format(new Date()));

// What a new page of the type starts as: the chosen template or the type's default one.
export async function pageInit(typeId: string, init: Partial<LLObject> = {}, templateId?: string): Promise<Partial<LLObject>> {
  const id = templateId ?? typeOf(typeId).template;
  const template = id ? await objects.get(id) : null;
  if (!template) return { typeId, ...init };
  const { templateOf: _, ...properties } = template.properties;
  return {
    typeId,
    title: fill(template.title),
    content: template.content,
    ...init,
    properties: { ...properties, ...init.properties },
  };
}

export const newPage = async (typeId: string, init: Partial<LLObject> = {}, templateId?: string) => createPage(await pageInit(typeId, init, templateId));

export const newTemplate = (typeId: string) =>
  createPage({ typeId, title: `${typeOf(typeId).name} template`, properties: { templateOf: typeId } });
