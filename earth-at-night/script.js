require([
  'esri/layers/BaseElevationLayer',
  'esri/layers/FeatureLayer',
  'esri/layers/WebTileLayer',

  'esri/Map',
  'esri/views/SceneView',

  'esri/widgets/Locate',
  'esri/widgets/BasemapToggle',
], function(
  BaseElevationLayer, FeatureLayer, WebTileLayer,
  Map, SceneView,
  Locate, BasemapToggle
) {
  // helper function that returns an instance of the Black Marble WebTileLayer
  // (it'll be reused by both the 3D ground terrain layer and the 2D layer draped on top)
  function createEarthAtNightWebTileLayer() {
    var earthAtNightWebTileLayer = new WebTileLayer({
      urlTemplate: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/{level}/{row}/{col}.png',
      copyright: 'Imagery provided by services from the Global Imagery Browse Services (GIBS), operated by the NASA/GSFC/Earth Science Data and Information System (<a href="https://earthdata.nasa.gov">ESDIS</a>) with funding provided by NASA/HQ.'
    });

    // only tile zoom levels 1 through 8 exist on the server resource,
    // thus we remove levels 0 and 9+ from the tileInfo.lods array to block attempts at fetching those tiles
    earthAtNightWebTileLayer.tileInfo.lods.splice(0, 1);
    earthAtNightWebTileLayer.tileInfo.lods.splice(8);

    return earthAtNightWebTileLayer;
  }

  // this is the custom 3D ground terrain elevation layer class
  // internally, it also relies on the Black Marble WebTileLayer to calculate elevation values
  var EarthAtNight3DLayerClass = BaseElevationLayer.createSubclass({
    properties: {
      // add on custom properties
      exaggerationFactor: 85000
    },
    load: function() {
      this._earthAtNightLayer = createEarthAtNightWebTileLayer();

      var internalLayerResourcePromise = this._earthAtNightLayer
        .load()
        .then(function() {
          // set the elevation layer's tileInfo to be equal to
          // the underlying WebTileLayer's own modified tileInfo
          this.tileInfo = this._earthAtNightLayer.tileInfo;
        }.bind(this));

      // add a promise that has to be resolved before the elevation layer is considered loaded
      this.addResolvingPromise(internalLayerResourcePromise);
    },
    fetchTile: function(level, row, col) {
      // fetch image tiles from the Black Marble WebTileLayer,
      // convert each pixel's "luminance" into elevation values,
      // and return a promise that resolves to an object with the properties defined in ElevationTileData
      return this._earthAtNightLayer.fetchTile(level, row, col)
        .then(function(imageElement) {
          var width = imageElement.width;
          var height = imageElement.height;

          var canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          var ctx = canvas.getContext('2d');
          ctx.drawImage(imageElement, 0, 0, width, height);

          var imageData = ctx.getImageData(0, 0, width, height).data;

          var elevations = [];

          for (var index = 0; index < imageData.length; index += 4) {
            var r = imageData[index];
            var g = imageData[index + 1];
            var b = imageData[index + 2];
            // opacity would be imageData[index + 3] but we don't need it

            // convert the RGB pixel color to a "luminance" from 0-1
            var luminance = new chroma([r, g, b]).luminance();

            // apply the terrain exaggeration factor to arrive at an elevation value
            // e.g. 0.75 luminance becomes a height of 63,750 meters
            var elevation = luminance * this.exaggerationFactor;

            // add the individual height value to the elevations array
            elevations.push(elevation);
          }

          // the promise returned in the elevation layer's "fetchTile" method
          // must resolve to an ElevationTileData object
          return {
            values: elevations,
            width: width,
            height: height,
            noDataValue: -1
          };
        }.bind(this));
    }
  });

  // create layer instances and then create SceneView, Map, widgets, etc.
  // - earthAtNight3DLayer
  // - earthAtNight2DLayer
  // - citiesLayer

  // this instance of the Black Marble WebTileLayer will be an operational layer that will be draped over the SceneView's custom ground terrain
  var earthAtNight2DLayer = createEarthAtNightWebTileLayer();

  // this instance of the custom 3D ground terrain elevation layer will be provided to the SceneView's ground layers property
  var earthAtNight3DLayer = new EarthAtNight3DLayerClass();

  // this cities feature layer provides the labeled callouts
  var citiesLayer = new FeatureLayer({
    url: 'https://services.arcgis.com/P3ePLMYs2RVChkJx/ArcGIS/rest/services/World_Cities/FeatureServer/0',
    elevationInfo: {
      mode: 'relative-to-ground'
    },
    returnZ: false,
    minScale: 25000000,
    definitionExpression: 'POP_RANK <= 6 OR STATUS LIKE \'%National%\'',
    outFields: ['CITY_NAME'],
    screenSizePerspectiveEnabled: true,
    featureReduction: {
      type: 'selection'
    },
    renderer: {
      type: 'simple',
      symbol: {
        // hide any kind of symbol showing up on the ground for the feature
        // because we're only intersted in the label with a callout
        type: 'point-3d',
        symbolLayers: [{
          type: 'icon',
          size: 0
        }]
      }
    },
    labelingInfo: [{
      labelPlacement: 'above-center',
      labelExpressionInfo: {
        expression: '$feature.CITY_NAME'
      },
      symbol: {
        type: 'label-3d',
        symbolLayers: [{
          type: 'text',
          material: {
            color: 'black'
          },
          halo: {
            color: [255, 255, 255, 0.75],
            size: 1.75
          },
          size: 10
        }],
        verticalOffset: {
          screenLength: 10000,
          maxWorldLength: 50000,
          minWorldLength: 1000
        },
        callout: {
          type: 'line',
          size: 2,
          color: [255, 255, 255, 0.75]
        }
      }
    }]
  });

  var view = new SceneView({
    container: 'viewDiv',
    map: new Map({
      ground: {
        layers: [
          earthAtNight3DLayer
        ],
        surfaceColor: 'black'
      },
      basemap: {
        baseLayers: [
          earthAtNight2DLayer
        ],
        title: 'Nighttime Lights',
        id: 'nighttime',
        thumbnailUrl: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/7/54/75.png'
      },
      layers: [
        citiesLayer
      ]
    }),
    camera: {
      position: {
        longitude: -74.2973328,
        latitude: 0.570868,
        z: 30000000
      },
      scale: 80000000,
      heading: 0,
      tilt: 0
    },
    environment: {
      atmosphere: {
        quality: 'high'
      }
    }
  });

  // add some additional widgets when the view is ready
  view.when(function(view) {
    var credits = document.getElementById('credits');
    view.ui.add(credits, 'bottom-right');
    credits.style.display = 'flex';

    // add a BasemapToggle widget to be able to see satellite imagery with custom terrain
    view.ui.add(new BasemapToggle({
      titleVisible: true,
      view: view,
      nextBasemap: 'satellite'
    }), 'top-right');

    // add a Locate widget and override its behavior
    // by zooming out to space and then in to the user's location
    view.ui.add(new Locate({
      view: view,
      graphic: null,
      goToOverride: function(view, goToParams) {
        var originalHeading = view.camera.clone().heading;

        return view.goTo({
          scale: 80000000,
          tilt: 0,
          heading: 0
        }, {
          speedFactor: 0.25
        })
          .then(function() {
            goToParams.target.scale = 3400000;
            goToParams.target.tilt = 55;
            goToParams.target.heading = originalHeading;

            return view.goTo(goToParams.target, {
              speedFactor: 0.5
            });
          });
      }
    }), 'top-right');
  });
});
