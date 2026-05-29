import React from "react";
import { View, Text, ScrollView, TouchableOpacity } from "react-native";

type Props = { children: React.ReactNode };
type State = { error: Error | null; info: string };

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: "" };

  static getDerivedStateFromError(error: Error): State {
    return { error, info: "" };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    this.setState({ error, info: info.componentStack ?? "" });
  }

  reset = () => this.setState({ error: null, info: "" });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <ScrollView style={{ flex: 1, backgroundColor: "#FFF1F3" }} contentContainerStyle={{ padding: 20, paddingTop: 60 }}>
        <Text style={{ fontSize: 18, fontWeight: "800", color: "#9F1239", marginBottom: 12 }}>
          Se produjo un error
        </Text>
        <Text style={{ fontSize: 14, color: "#111", marginBottom: 8 }}>
          {String(this.state.error?.name)}: {String(this.state.error?.message)}
        </Text>
        {this.state.error?.stack ? (
          <Text style={{ fontSize: 11, color: "#444", fontFamily: "monospace", marginBottom: 16 }}>
            {String(this.state.error.stack).slice(0, 2000)}
          </Text>
        ) : null}
        {this.state.info ? (
          <Text style={{ fontSize: 11, color: "#666", fontFamily: "monospace" }}>
            {this.state.info.slice(0, 2000)}
          </Text>
        ) : null}
        <TouchableOpacity
          onPress={this.reset}
          style={{ marginTop: 24, backgroundColor: "#EC4899", paddingVertical: 14, borderRadius: 999, alignItems: "center" }}
        >
          <Text style={{ color: "#fff", fontWeight: "800" }}>Reintentar</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }
}
