import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import * as TabsComponents from 'fumadocs-ui/components/tabs';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { DemoVideo } from './components/demo-video';

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...TabsComponents,
    img: (props) => <ImageZoom {...(props as any)} />,
    DemoVideo,
    ...components,
  };
}
