import { cloneElement, isValidElement, type ReactNode } from "react";
import type { RenderMap } from "a2ui-core";
import {
  AudioPlayer,
  Button,
  Card,
  CheckBox,
  Column,
  DateTimeInput,
  Divider,
  Empty,
  Icon,
  Image,
  List,
  Modal,
  MultipleChoice,
  Row,
  Slider,
  Tabs,
  Text,
  TextField,
  Video,
} from "./components/index.js";

function keyedChildren(children: unknown): ReactNode {
  if (!Array.isArray(children)) {
    return children as ReactNode;
  }

  return children.map((child, index) => {
    if (!isValidElement<{ componentId?: string }>(child)) {
      return child as ReactNode;
    }
    return cloneElement(child, { key: child.props.componentId ?? String(index) });
  });
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

/** 组件名 → React 渲染函数，交给 a2ui-core init({ renderMap })。覆盖当前 catalog 支持的类型。 */
export const renderMap: RenderMap = {
  Text: (props) => (
    <Text
      text={String(props.text ?? "")}
      usageHint={str(props.usageHint)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  Image: (props) => (
    <Image
      url={String(props.url ?? "")}
      prompt={str(props.prompt)}
      fit={str(props.fit)}
      usageHint={str(props.usageHint)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  Icon: (props) => (
    <Icon name={String(props.name ?? "")} componentId={str(props.componentId)} hasMounted={Boolean(props.hasMounted)} />
  ),
  Video: (props) => (
    <Video url={String(props.url ?? "")} componentId={str(props.componentId)} hasMounted={Boolean(props.hasMounted)} />
  ),
  AudioPlayer: (props) => (
    <AudioPlayer
      url={String(props.url ?? "")}
      description={str(props.description)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  Column: (props) => (
    <Column
      distribution={str(props.distribution)}
      alignment={str(props.alignment)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    >
      {keyedChildren(props.children)}
    </Column>
  ),
  Row: (props) => (
    <Row
      distribution={str(props.distribution)}
      alignment={str(props.alignment)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    >
      {keyedChildren(props.children)}
    </Row>
  ),
  List: (props) => (
    <List
      direction={str(props.direction)}
      alignment={str(props.alignment)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    >
      {keyedChildren(props.children)}
    </List>
  ),
  Card: (props) => (
    <Card componentId={str(props.componentId)} hasMounted={Boolean(props.hasMounted)}>
      {keyedChildren(props.children)}
    </Card>
  ),
  Tabs: (props) => (
    <Tabs
      tabItems={props.tabItems as Array<{ title?: string; childId?: string }> | undefined}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    >
      {keyedChildren(props.children)}
    </Tabs>
  ),
  Divider: (props) => (
    <Divider axis={str(props.axis)} componentId={str(props.componentId)} hasMounted={Boolean(props.hasMounted)} />
  ),
  Modal: (props) => (
    <Modal componentId={str(props.componentId)} hasMounted={Boolean(props.hasMounted)}>
      {keyedChildren(props.children)}
    </Modal>
  ),
  Button: (props) => (
    <Button
      primary={bool(props.primary)}
      action={props.action as { name?: string; context?: Array<{ key: string; value?: Record<string, unknown> }> } | undefined}
      componentId={str(props.componentId)}
      surfaceId={str(props.surfaceId)}
      hasMounted={Boolean(props.hasMounted)}
    >
      {keyedChildren(props.children)}
    </Button>
  ),
  CheckBox: (props) => (
    <CheckBox
      label={String(props.label ?? "")}
      value={bool(props.value)}
      valuePath={str(props.valuePath)}
      componentId={str(props.componentId)}
      surfaceId={str(props.surfaceId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  TextField: (props) => (
    <TextField
      label={String(props.label ?? "")}
      text={str(props.text)}
      textPath={str(props.textPath)}
      textFieldType={str(props.textFieldType)}
      validationRegexp={str(props.validationRegexp)}
      componentId={str(props.componentId)}
      surfaceId={str(props.surfaceId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  DateTimeInput: (props) => (
    <DateTimeInput
      value={str(props.value)}
      valuePath={str(props.valuePath)}
      enableDate={bool(props.enableDate)}
      enableTime={bool(props.enableTime)}
      componentId={str(props.componentId)}
      surfaceId={str(props.surfaceId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  MultipleChoice: (props) => (
    <MultipleChoice
      options={props.options as Array<{ label?: string; value: string }> | undefined}
      selections={props.selections as string[] | undefined}
      selectionsPath={str(props.selectionsPath)}
      variant={str(props.variant)}
      filterable={bool(props.filterable)}
      maxAllowedSelections={num(props.maxAllowedSelections)}
      componentId={str(props.componentId)}
      surfaceId={str(props.surfaceId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  Slider: (props) => (
    <Slider
      value={num(props.value)}
      valuePath={str(props.valuePath)}
      minValue={num(props.minValue)}
      maxValue={num(props.maxValue)}
      componentId={str(props.componentId)}
      surfaceId={str(props.surfaceId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
  Empty: (props) => (
    <Empty
      description={str(props.description)}
      componentId={str(props.componentId)}
      hasMounted={Boolean(props.hasMounted)}
    />
  ),
};
