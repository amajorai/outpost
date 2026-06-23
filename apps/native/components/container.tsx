import { cn } from "heroui-native";
import type { PropsWithChildren, ReactElement } from "react";
import {
  type RefreshControlProps,
  ScrollView,
  View,
  type ViewProps,
} from "react-native";
import Animated, { type AnimatedProps } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const AnimatedView = Animated.createAnimatedComponent(View);

type Props = AnimatedProps<ViewProps> & {
  className?: string;
  /** Optional pull-to-refresh control forwarded to the inner ScrollView. */
  refreshControl?: ReactElement<RefreshControlProps>;
};

export function Container({
  children,
  className,
  refreshControl,
  ...props
}: PropsWithChildren<Props>) {
  const insets = useSafeAreaInsets();

  return (
    <AnimatedView
      className={cn("flex-1 bg-background", className)}
      style={{
        paddingBottom: insets.bottom,
      }}
      {...props}
    >
      <ScrollView
        contentContainerStyle={{ flexGrow: 1 }}
        refreshControl={refreshControl}
      >
        {children}
      </ScrollView>
    </AnimatedView>
  );
}
