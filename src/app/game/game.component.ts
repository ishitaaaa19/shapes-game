import { Component, ElementRef, OnInit, ViewChild, AfterViewInit } from '@angular/core';
import * as BABYLON from 'babylonjs';
import { AdvancedDynamicTexture, Button } from 'babylonjs-gui';
import { Client, Room, getStateCallbacks } from 'colyseus.js';

@Component({
  selector: 'babylon-game',
  templateUrl: './game.component.html',
  styleUrls: ['./game.component.css']
})
export class GameComponent implements OnInit {
  @ViewChild('renderCanvas', { static: true }) renderCanvas!: ElementRef<HTMLCanvasElement>;
  renderFlag: Boolean = true;
  public room!: Room;
  private engine!: BABYLON.Engine;
  private scene!: BABYLON.Scene;
  private camera!: BABYLON.ArcRotateCamera;
  private light!: BABYLON.HemisphericLight;
  private shapes: BABYLON.Mesh[] = [];
  private pickedMesh: any | null = null;
  private shapesMap: Map<string, Map<string, BABYLON.Mesh>> = new Map();
  private playerId!: string;
  private draggedShapes!: any[]
  private playerShapeMap = new Map<string, string[]>();

  constructor() {

    this.draggedShapes = [];
  }

  async ngOnInit() {
    const canvas = this.renderCanvas.nativeElement;
    this.engine = new BABYLON.Engine(canvas, true);
    await this.initBabylonScene()
    // Only set up room events if room is already available
    if (this.room) {
      this.roomEvents();
    }

  }

  async initBabylonScene() {
    this.createScene();
    this.addSendBtn();

    await this.connect();
    this.doRender();

    return true;
  }


  private doRender() {
    if (!this.renderFlag) return;

    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    window.addEventListener('resize', () => {
      this.engine.resize();
    });

    this.renderFlag = false;
  }

  async connect() {
    try {
      let client = new Client("http://localhost:2567");
      this.room = await client.joinOrCreate("my_room");

      if (!this.room) {
        throw new Error(" Room is still undefined after joining.");
      }
      console.log(" Connected to roomId:::", this.room.roomId);
    } catch (error) {
      console.error("Couldn't connect to room:", error);
    }
  }

  createScene = () => {

    this.scene = new BABYLON.Scene(this.engine);

    const ground = BABYLON.MeshBuilder.CreateGround("ground", { width: 10, height: 15 }, this.scene);
    ground.material = new BABYLON.StandardMaterial("groundMat", this.scene);
    (ground.material as any).diffuseColor = new BABYLON.Color3(0.6, 0.6, 0.6);

    this.camera = new BABYLON.ArcRotateCamera("camera", -Math.PI / 2, 0, 20, ground.absolutePosition, this.scene);
    // this.camera.attachControl(canvas, true);

    this.light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), this.scene);
    this.light.intensity = 0.5;

    // Shape Receiving Area
    const shapeReceived = BABYLON.MeshBuilder.CreatePlane("selectionReceive", { width: 6, height: 1 }, this.scene);
    shapeReceived.position = new BABYLON.Vector3(-1.5, 0.5, 6);
    shapeReceived.rotation.x = Math.PI / 2;
    shapeReceived.material = new BABYLON.StandardMaterial("selectionMat", this.scene);
    (shapeReceived.material as any).diffuseColor = BABYLON.Color3.Yellow();

    // Shape Send Area
    const shapeSend = BABYLON.MeshBuilder.CreatePlane("selectionSend", { width: 8, height: 1 }, this.scene);
    shapeSend.position = new BABYLON.Vector3(1, 0.5, 4);
    shapeSend.rotation.x = Math.PI / 2;
    shapeSend.material = new BABYLON.StandardMaterial("selectionMat", this.scene);
    (shapeSend.material as any).diffuseColor = BABYLON.Color3.Blue();

    // Drop Zone
    const dropZone = BABYLON.MeshBuilder.CreatePlane("dropZone", { width: 6, height: 3 }, this.scene);
    dropZone.position = new BABYLON.Vector3(0, 0.5, -5);
    dropZone.rotation.x = Math.PI / 2;
    dropZone.material = new BABYLON.StandardMaterial("dropZoneMat", this.scene);
    (dropZone.material as any).diffuseColor = new BABYLON.Color3(0.5, 1, 1);
    dropZone.material.alpha = 0.5;

  }

  addSendBtn() {

    if (!this.scene) {
      console.error("Scene is not initialized!");
      return;
    }

    var gui = AdvancedDynamicTexture.CreateFullscreenUI("myUI");
    var button = Button.CreateSimpleButton("button", "Send");
    button.top = "-180px";
    button.left = "120px";
    button.width = "100px";
    button.height = "30px";
    button.cornerRadius = 20;
    button.thickness = 4;
    button.children[0].color = "#DFF9FB";
    button.children[0].fontSize = 20;
    button.color = "#FF7979";
    button.background = "#EB4D4B";

    button.onPointerClickObservable.add(() => {
      this.room.send("sendShapes", {
        shapes: this.draggedShapes,
        playerId: this.playerId
      })

    });

    gui.addControl(button);
  }

  private roomEvents() {
    const $ = getStateCallbacks(this.room);
    console.log("Initial room state:", this.room.state);

    let shapesInitialized = false;

    $(this.room.state)['players'].onAdd((player, sessionId) => {
      this.playerId = sessionId;
      console.log(`Player added - ID: ${sessionId}, Name: ${player.player_name}`);

      if (this.room.state.players.size === 4 && !shapesInitialized) {
            shapesInitialized = true;
            this.createPlayerShapes(sessionId);
        this.enableDragging();
      }
    });

    $(this.room.state)['players'].onRemove((_, sessionId) => {
      console.log(`Player left: ${sessionId}`);
      this.cleanupPlayerShapes(sessionId);
      shapesInitialized = false;
    });

  }

  private createPlayerShapes(playerId: string): void {
    const player = this.room.state.players.get(playerId);


    if (!player) {
      console.warn(`Player with ID ${playerId} not found.`);
      return;
    }

    // Prevent duplicate shape assignments
    if (this.playerShapeMap.has(playerId)) {
      console.warn(`Shapes already assigned to Player ${playerId}. Skipping.`);
      return;
    }

    console.log(`Creating shapes for Player ${playerId} with ${player.shapeIds.size} shapes`);

    const assignedShapes: string[] = [];

    // console.log("shapeIds", player.shapeIds)

    player.shapeIds.forEach((shapeId: any, index: any) => {
      const shapeData = this.room.state.shapes.get(shapeId);

      if (!shapeData) {
        console.warn(`Shape data not found for ID: ${shapeId}`);
        return;
      }

      let shape: BABYLON.Mesh;
      const x = -2 + (index % 5);
      const z = 2.5 - (index % 2) * 1.5;

      const uniqueName = `${shapeId}`;

      if (this.scene.getMeshByName(uniqueName)) {
        console.warn(`Shape ${uniqueName} already exists!`);
        return;
      }

      switch (shapeData.shapeType) {
        case "circle":
          shape = BABYLON.MeshBuilder.CreateSphere(uniqueName, { diameter: 0.8 }, this.scene);
          break;
        case "square":
          shape = BABYLON.MeshBuilder.CreateBox(uniqueName, { size: 0.8 }, this.scene);
          break;
        default:
          shape = BABYLON.MeshBuilder.CreateCapsule(uniqueName, { radius: 0.5, tessellation: 3 }, this.scene);
          shape.rotation = new BABYLON.Vector3(0, Math.PI / 3, 0);
      }

      shape.position = new BABYLON.Vector3(x, 0.5, z);
      shape.material = new BABYLON.StandardMaterial("shapeMat", this.scene);
      (shape.material as any).diffuseColor = BABYLON.Color3.White();
      shape.isPickable = true;

      this.shapes.push(shape)
      assignedShapes.push(shapeId);

      console.log(` Assigned shape ${shapeId} to Player ${playerId} at (${x}, 0.5, ${z})`);
    });

    this.playerShapeMap.set(playerId, assignedShapes);
    // console.log(this.playerShapeMap)
    // console.log(` Total shapes assigned to Player ${playerId}:`, assignedShapes);
  }

private cleanupPlayerShapes(playerId: string): void {
    // Remove from scene
    const prefix = `p${playerId}_`;
    this.scene.meshes
        .filter(m => m.name.startsWith(prefix))
        .forEach(m => m.dispose());
    
    // Remove from tracking
    this.playerShapeMap.delete(playerId);
}

  private enableDragging(): void {
    this.scene.onPointerDown = (evt, pickResult) => {
      if (pickResult.hit && pickResult.pickedMesh) {
        const isShape = this.shapes.some(shape => shape === pickResult.pickedMesh);
        if (isShape) {
          this.pickedMesh = pickResult.pickedMesh;
          // console.log("Picked mesh:", this.pickedMesh.id);
        }
      }
    };

    this.scene.onPointerMove = (evt) => {
      if (this.pickedMesh) {
        const pickInfo = this.scene.pick(this.scene.pointerX, this.scene.pointerY);
        if (pickInfo.hit) {
          this.pickedMesh.position.x = (pickInfo.pickedPoint as any).x;
          this.pickedMesh.position.z = (pickInfo.pickedPoint as any).z;
        }
      }
    };

    this.scene.onPointerUp = () => {

      if (this.pickedMesh) {
        const blueZone = this.scene.getMeshByName("selectionSend")
        if (this.pickedMesh.intersectsMesh(blueZone, false)) {
          console.log(` Shape ${this.pickedMesh.id} inside Blue Zone`);
          this.draggedShapes?.push(this.pickedMesh.id);
          console.log(this.draggedShapes)

          // Set grid layout

        } else {

        }
      }
      this.pickedMesh = null;

    };
  }
}
