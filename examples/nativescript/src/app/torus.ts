import { nsView } from '@ng-native/nativescript';

/** A spinning SceneKit torus, drawn solid or as a wireframe. iOS only. */
export const torus = nsView<{ wireframe: boolean }, SCNView>({
  create(props) {
    'worklet';
    const view = SCNView.alloc().initWithFrame(CGRectZero);
    view.scene = SCNScene.scene();
    view.allowsCameraControl = true;
    view.backgroundColor = UIColor.clearColor;
    const geometry = SCNTorus.torusWithRingRadiusPipeRadius(1.4, 0.45);
    geometry.firstMaterial!.diffuse.contents = UIColor.systemIndigoColor;
    geometry.firstMaterial!.fillMode = props.wireframe ? SCNFillMode.Lines : SCNFillMode.Fill;
    const node = SCNNode.nodeWithGeometry(geometry);
    node.runAction(SCNAction.repeatActionForever(SCNAction.rotateByXYZDuration(1, 1, 0, 3)));
    view.scene!.rootNode.addChildNode(node);
    view.autoenablesDefaultLighting = true;
    return view;
  },
  update(view, props) {
    'worklet';
    const geometry = view.scene!.rootNode.childNodes.objectAtIndex(0).geometry!;
    geometry.firstMaterial!.fillMode = props.wireframe ? SCNFillMode.Lines : SCNFillMode.Fill;
  },
});
